import express from "express";
import { Prisma } from "../generated/prisma/client";
import { prisma } from "../db/db.ts";
import { authenticatedUserId, middleware } from "../middleware/middleware.ts";
import { order_val } from "../validation/Order_Val.ts";
import {
  matchingEngine,
  round8,
  type BookOrder,
  type MarketType,
  type Side,
} from "../services/matching.ts";
import {
  changeBalance,
  closePosition,
  fixed,
  increasePosition,
  InsufficientBalanceError,
  liquidateAtMark,
} from "../services/settlement.ts";
import { fundingRateFor } from "../services/funding.ts";
import { serialize } from "../services/tradingQueue.ts";

const router = express.Router();
const defaultMarkets = [
  { name: "Bitcoin", symbol: "BTC-USDT", baseAsset: "BTC", price: 65_000 },
  { name: "Ethereum", symbol: "ETH-USDT", baseAsset: "ETH", price: 3_200 },
];

function mapOrder(order: {
  id: number;
  user: number;
  StockName: string;
  category: "LIMIT" | "MARKET";
  type: "BID" | "ASK";
  status: "OPEN" | "FILLED" | "CANCELLED";
  marketType: MarketType;
  price: unknown;
  volume: unknown;
  remaining: unknown;
  leverage: number;
  createdAt: Date;
}): BookOrder {
  return {
    id: order.id,
    userId: order.user,
    symbol: order.StockName,
    marketType: order.marketType,
    side: order.type,
    category: order.category,
    price: order.price === null ? null : Number(order.price),
    remaining: Number(order.remaining),
    leverage: order.leverage,
    createdAt: order.createdAt.getTime(),
  };
}

export async function initializeOrderBook() {
  for (const market of defaultMarkets) {
    await prisma.stocks.upsert({
      where: { StockSymbol: market.symbol },
      create: { StockName: market.name, StockSymbol: market.symbol },
      update: {},
    });

    for (const marketType of ["SPOT", "PERP"] as const) {
      const lastFill = await prisma.fills.findFirst({
        where: { asset: market.symbol, marketType },
        orderBy: { createdAt: "desc" },
      });
      const referencePrice = lastFill ? Number(lastFill.price) : market.price;
      matchingEngine.setLastPrice(market.symbol, marketType, referencePrice);
      const openOrders = await prisma.order.findMany({
        where: { StockName: market.symbol, marketType, status: "OPEN", remaining: { gt: 0 } },
        orderBy: { createdAt: "asc" },
      });
      for (const order of openOrders) matchingEngine.add(mapOrder(order));

      for (let level = 1; level <= 5; level++) {
        const offset = level * 0.001;
        const createdAt = Date.now() - 10_000 + level;
        const synthetic = (side: Side, price: number): BookOrder => ({
          id: -((marketType === "PERP" ? 100 : 0) + (market.symbol === "ETH-USDT" ? 10 : 0) + level * 2 + (side === "ASK" ? 1 : 0)),
          userId: 0,
          symbol: market.symbol,
          marketType,
          side,
          category: "LIMIT",
          price: round8(price),
          remaining: 100,
          leverage: 1,
          createdAt,
          synthetic: true,
        });
        matchingEngine.add(synthetic("BID", referencePrice * (1 - offset)));
        matchingEngine.add(synthetic("ASK", referencePrice * (1 + offset)));
      }
    }
  }

  const latestFills = await prisma.fills.findMany({
    orderBy: { createdAt: "desc" },
    distinct: ["asset", "marketType"],
  });
  for (const fill of latestFills) {
    matchingEngine.setLastPrice(fill.asset, fill.marketType, Number(fill.price));
  }
}

function getReserve(
  marketType: MarketType,
  side: Side,
  leverage: number,
  limitPrice: number | undefined,
  remaining: number,
  trades: Array<{ price: number; quantity: number }>,
): number {
  if (marketType === "PERP") {
    return round8(
      trades.reduce((sum, trade) => sum + (trade.price * trade.quantity) / leverage, 0) +
      (limitPrice === undefined ? 0 : (limitPrice * remaining) / leverage),
    );
  }
  if (side === "ASK") {
    return round8(trades.reduce((sum, trade) => sum + trade.quantity, 0) + remaining);
  }
  return round8(
    trades.reduce((sum, trade) => sum + (limitPrice ?? trade.price) * trade.quantity, 0) +
    (limitPrice === undefined ? 0 : limitPrice * remaining),
  );
}

async function settleUserFill(
  transaction: Prisma.TransactionClient,
  order: {
    userId: number;
    symbol: string;
    side: Side;
    marketType: MarketType;
    category: "LIMIT" | "MARKET";
    price: number | undefined;
    leverage: number;
  },
  trade: { price: number; quantity: number },
) {
  if (order.marketType === "SPOT") {
    if (order.side === "BID") {
      const reservedPrice = order.category === "LIMIT" ? order.price! : trade.price;
      const reserved = reservedPrice * trade.quantity;
      await changeBalance(transaction, order.userId, "USDT", (reserved - trade.price * trade.quantity), -reserved);
      await changeBalance(transaction, order.userId, order.symbol.split("-")[0]!, trade.quantity, 0);
    } else {
      await changeBalance(transaction, order.userId, order.symbol.split("-")[0]!, 0, -trade.quantity);
      await changeBalance(transaction, order.userId, "USDT", trade.price * trade.quantity, 0);
    }
    return;
  }

  const margin = (trade.price * trade.quantity) / order.leverage;
  await changeBalance(transaction, order.userId, "USDT", 0, -margin);
  await increasePosition(transaction, {
    userId: order.userId,
    symbol: order.symbol,
    side: order.side === "BID" ? "LONG" : "SHORT",
    quantity: trade.quantity,
    price: trade.price,
    margin,
  });
}

router.get("/markets", async (_req, res) => {
  try {
    const markets = await Promise.all(defaultMarkets.map(async (market) => {
      const [spotDepth, perpDepth, funding] = await Promise.all([
        Promise.resolve(matchingEngine.depth(market.symbol, "SPOT")),
        Promise.resolve(matchingEngine.depth(market.symbol, "PERP")),
        fundingRateFor(market.symbol),
      ]);
      return {
        name: market.name,
        symbol: market.symbol,
        baseAsset: market.baseAsset,
        quoteAsset: "USDT",
        lastPrice: matchingEngine.getLastPrice(market.symbol, "SPOT") ?? market.price,
        perpLastPrice: matchingEngine.getLastPrice(market.symbol, "PERP") ?? market.price,
        fundingRate: funding.rate,
        nextFundingAt: funding.nextFundingAt,
        spotDepth,
        perpDepth,
      };
    }));
    return res.json({ success: true, details: markets });
  } catch (error) {
    console.error("Market lookup failed", error);
    return res.status(500).json({ success: false, message: "Unable to load markets" });
  }
});

router.get("/markets/:symbol/depth", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const marketType = req.query.marketType === "PERP" ? "PERP" : "SPOT";
  try {
    const stock = await prisma.stocks.findUnique({ where: { StockSymbol: symbol } });
    if (!stock) return res.status(404).json({ success: false, message: "Market not found" });
    return res.json({
      success: true,
      details: {
        symbol,
        marketType,
        lastPrice: matchingEngine.getLastPrice(symbol, marketType),
        ...matchingEngine.depth(symbol, marketType),
      },
    });
  } catch (error) {
    console.error("Order book lookup failed", error);
    return res.status(500).json({ success: false, message: "Unable to load order book" });
  }
});

router.get("/markets/:symbol/trades", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const marketType = req.query.marketType === "PERP" ? "PERP" : "SPOT";
  try {
    const stock = await prisma.stocks.findUnique({ where: { StockSymbol: symbol } });
    if (!stock) return res.status(404).json({ success: false, message: "Market not found" });
    const trades = await prisma.fills.findMany({
      where: { asset: symbol, marketType },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const seenTrades = new Set<string>();
    const uniqueTrades = trades.filter((trade) => {
      const key = `${Math.min(trade.order, trade.orginalOrderId)}:${Math.max(trade.order, trade.orginalOrderId)}`;
      if (seenTrades.has(key)) return false;
      seenTrades.add(key);
      return true;
    });
    return res.json({
      success: true,
      details: uniqueTrades.map((trade) => ({
        id: trade.id,
        price: Number(trade.price),
        quantity: Number(trade.quantity),
        side: trade.type,
        createdAt: trade.createdAt,
      })),
    });
  } catch (error) {
    console.error("Recent trade lookup failed", error);
    return res.status(500).json({ success: false, message: "Unable to load recent trades" });
  }
});

router.get("/orders", middleware, async (_req, res) => {
  try {
    const orders = await prisma.order.findMany({
      where: { user: authenticatedUserId(res), status: "OPEN" },
      orderBy: { createdAt: "desc" },
    });
    return res.json({
      success: true,
      details: orders.map((order) => ({
        id: order.id,
        symbol: order.StockName,
        marketType: order.marketType,
        side: order.type,
        category: order.category,
        price: order.price === null ? null : Number(order.price),
        volume: Number(order.volume),
        remaining: Number(order.remaining),
        leverage: order.leverage,
        createdAt: order.createdAt,
      })),
    });
  } catch (error) {
    console.error("Open order lookup failed", error);
    return res.status(500).json({ success: false, message: "Unable to load open orders" });
  }
});

router.post("/orders", middleware, async (req, res) => {
  const parsed = order_val.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: "Invalid order details", issues: parsed.error.issues });
  }

  try {
    const result = await serialize(async () => {
      const userId = authenticatedUserId(res);
      const input = parsed.data;
      const stock = await prisma.stocks.findUnique({ where: { StockSymbol: input.symbol } });
      if (!stock) throw new OrderRequestError("Unknown market", 404);
      if (input.volume > 1_000_000 || (input.price ?? 0) > 1_000_000_000_000) {
        throw new OrderRequestError("Order size exceeds the supported range", 400);
      }

      if (input.marketType === "PERP") {
        const position = await prisma.perpPosition.findUnique({
          where: { userId_symbol: { userId, symbol: input.symbol } },
        });
        const requestedSide = input.type === "BID" ? "LONG" : "SHORT";
        if (position && position.side !== requestedSide) {
          throw new OrderRequestError("Close the existing position before opening the opposite side", 409);
        }
        const oppositeOrder = await prisma.order.findFirst({
          where: {
            user: userId,
            Stock: stock.id,
            marketType: "PERP",
            status: "OPEN",
            type: input.type === "BID" ? "ASK" : "BID",
          },
        });
        if (oppositeOrder) {
          throw new OrderRequestError("Cancel opposite-side open orders before trading this market", 409);
        }
      }

      const incoming: BookOrder = {
        id: 0,
        userId,
        symbol: input.symbol,
        marketType: input.marketType,
        side: input.type,
        category: input.category,
        price: input.price ?? null,
        remaining: input.volume,
        leverage: input.marketType === "PERP" ? input.leverage : 1,
        createdAt: Date.now(),
      };
      const plan = matchingEngine.plan(incoming);
      const matched = round8(input.volume - plan.remaining);
      const notional = input.category === "LIMIT"
        ? input.volume * input.price!
        : plan.trades.reduce((sum, trade) => sum + trade.price * trade.quantity, 0);
      if (notional > 10_000_000) {
        throw new OrderRequestError("Order notional exceeds the supported demo limit", 400);
      }
      if (input.category === "MARKET" && matched <= 0) {
        throw new OrderRequestError("No liquidity is available for this market order", 409);
      }
      const remaining = input.category === "LIMIT" ? plan.remaining : 0;
      const reserve = getReserve(
        input.marketType,
        input.type,
        incoming.leverage,
        input.price,
        remaining,
        plan.trades,
      );
      const cancelledOrders: number[] = [];
      const order = await prisma.$transaction(async (transaction) => {
        const reserveAsset = input.marketType === "PERP" || input.type === "BID"
          ? "USDT"
          : input.symbol.split("-")[0]!;
        await changeBalance(transaction, userId, reserveAsset, -reserve, reserve);
        const created = await transaction.order.create({
          data: {
            user: userId,
            Stock: stock.id,
            StockName: input.symbol,
            category: input.category,
            type: input.type,
            status: remaining > 0 ? "OPEN" : matched >= input.volume ? "FILLED" : "CANCELLED",
            marketType: input.marketType,
            price: input.price === undefined ? null : fixed(input.price),
            volume: fixed(input.volume),
            remaining: fixed(remaining),
            leverage: incoming.leverage,
          },
        });

        for (const trade of plan.trades) {
          await settleUserFill(transaction, {
            userId,
            symbol: input.symbol,
            side: input.type,
            marketType: input.marketType,
            category: input.category,
            price: input.price,
            leverage: incoming.leverage,
          }, trade);

          if (!trade.maker.synthetic) {
            await settleUserFill(transaction, {
              userId: trade.maker.userId,
              symbol: input.symbol,
              side: trade.maker.side,
              marketType: input.marketType,
              category: trade.maker.category,
              price: trade.maker.price ?? undefined,
              leverage: trade.maker.leverage,
            }, trade);
          }

          const fillData = {
            asset: input.symbol,
            category: input.category,
            legacyQuantity: Math.trunc(trade.quantity),
            quantity: fixed(trade.quantity),
            price: fixed(trade.price),
            marketType: input.marketType,
          };
          await transaction.fills.create({
            data: {
              order: created.id,
              user: userId,
              type: input.type,
              orginalOrderId: trade.maker.id,
              ...fillData,
            },
          });
          if (!trade.maker.synthetic) {
            await transaction.fills.create({
              data: {
                order: trade.maker.id,
                user: trade.maker.userId,
                type: trade.maker.side,
                orginalOrderId: created.id,
                category: trade.maker.category,
                asset: input.symbol,
                legacyQuantity: Math.trunc(trade.quantity),
                quantity: fixed(trade.quantity),
                price: fixed(trade.price),
                marketType: input.marketType,
              },
            });
            const makerRemaining = plan.makerUpdates.get(trade.maker.id) ?? 0;
            await transaction.order.update({
              where: { id: trade.maker.id },
              data: {
                remaining: fixed(makerRemaining),
                status: makerRemaining > 0 ? "OPEN" : "FILLED",
              },
            });
          }

          if (input.marketType === "PERP") {
            const liquidations = await liquidateAtMark(transaction, input.symbol, trade.price);
            cancelledOrders.push(...liquidations.flatMap((liquidation) => liquidation.cancelledOrderIds));
          }
        }

        return created;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

      matchingEngine.commit({ ...incoming, id: order.id, remaining: input.volume }, plan);
      for (const cancelledOrderId of cancelledOrders) {
        matchingEngine.remove(cancelledOrderId, input.symbol, "PERP");
      }
      return {
        id: order.id,
        symbol: order.StockName,
        marketType: order.marketType,
        side: order.type,
        category: order.category,
        status: order.status,
        price: order.price === null ? null : Number(order.price),
        volume: Number(order.volume),
        remaining: Number(order.remaining),
        leverage: order.leverage,
        fills: plan.trades.map((trade) => ({ price: trade.price, quantity: trade.quantity })),
      };
    });
    return res.status(201).json({ success: true, message: "Order accepted", details: result });
  } catch (error) {
    if (error instanceof OrderRequestError) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    if (error instanceof InsufficientBalanceError) {
      return res.status(409).json({ success: false, message: error.message });
    }
    console.error("Order placement failed", error);
    return res.status(500).json({ success: false, message: "Unable to place order" });
  }
});

router.delete("/orders/:orderId", middleware, async (req, res) => {
  const orderId = Number(req.params.orderId);
  if (!Number.isSafeInteger(orderId) || orderId < 1) {
    return res.status(400).json({ success: false, message: "Invalid order id" });
  }
  try {
    const result = await serialize(async () => {
      const userId = authenticatedUserId(res);
      const order = await prisma.order.findFirst({
        where: { id: orderId, user: userId, status: "OPEN" },
      });
      if (!order) throw new OrderRequestError("Open order not found", 404);

      await prisma.$transaction(async (transaction) => {
        const remaining = Number(order.remaining);
        const reserveAsset = order.marketType === "PERP" || order.type === "BID"
          ? "USDT"
          : order.StockName.split("-")[0]!;
        const refund = order.marketType === "PERP"
          ? (remaining * Number(order.price)) / order.leverage
          : order.type === "BID"
            ? remaining * Number(order.price)
            : remaining;
        await changeBalance(transaction, userId, reserveAsset, refund, -refund);
        await transaction.order.update({
          where: { id: order.id },
          data: { status: "CANCELLED", remaining: "0" },
        });
      });
      matchingEngine.remove(order.id, order.StockName, order.marketType);
      return { id: order.id, status: "CANCELLED" };
    });
    return res.json({ success: true, message: "Order cancelled", details: result });
  } catch (error) {
    if (error instanceof OrderRequestError) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    console.error("Order cancellation failed", error);
    return res.status(500).json({ success: false, message: "Unable to cancel order" });
  }
});

router.post("/positions/:symbol/close", middleware, async (req, res) => {
  const rawSymbol = req.params.symbol;
  const symbol = (Array.isArray(rawSymbol) ? rawSymbol[0] : rawSymbol)?.toUpperCase();
  if (!symbol) return res.status(400).json({ success: false, message: "Invalid market symbol" });
  try {
    const result = await serialize(async () => {
      const userId = authenticatedUserId(res);
      const position = await prisma.perpPosition.findUnique({
        where: { userId_symbol: { userId, symbol } },
      });
      if (!position) throw new OrderRequestError("Open position not found", 404);

      const openOrders = await prisma.order.count({
        where: { user: userId, StockName: symbol, marketType: "PERP", status: "OPEN" },
      });
      if (openOrders > 0) {
        throw new OrderRequestError("Cancel open perp orders before closing this position", 409);
      }

      const price = matchingEngine.getLastPrice(symbol, "PERP");
      if (!price) throw new OrderRequestError("There is no mark price for this position", 409);
      const settlement = await prisma.$transaction(async (transaction) => {
        const current = await transaction.perpPosition.findUnique({
          where: { userId_symbol: { userId, symbol } },
        });
        if (!current) throw new OrderRequestError("Open position not found", 404);
        const closed = await closePosition(transaction, current, price);
        return { ...closed, side: current.side, quantity: Number(current.quantity), price };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return settlement;
    });
    return res.json({ success: true, message: "Position closed at the latest mark price", details: result });
  } catch (error) {
    if (error instanceof OrderRequestError) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    console.error("Position close failed", error);
    return res.status(500).json({ success: false, message: "Unable to close position" });
  }
});

class OrderRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "OrderRequestError";
  }
}

export default router;
