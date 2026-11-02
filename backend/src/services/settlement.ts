import type { Prisma } from "../generated/prisma/client";
import { round8 } from "./matching.ts";

export class InsufficientBalanceError extends Error {
  constructor(asset: string) {
    super(`Insufficient available ${asset}`);
    this.name = "InsufficientBalanceError";
  }
}

export function fixed(value: number): string {
  return round8(value).toFixed(8);
}

export async function changeBalance(
  transaction: Prisma.TransactionClient,
  userId: number,
  asset: string,
  availableDelta: number,
  lockedDelta: number,
) {
  const where = { userId_asset: { userId, asset } };
  const current = await transaction.assetBalance.findUnique({ where });
  const available = round8(Number(current?.available ?? 0) + availableDelta);
  const locked = round8(Number(current?.locked ?? 0) + lockedDelta);
  if (available < -0.00000001 || locked < -0.00000001) {
    throw new InsufficientBalanceError(asset);
  }

  return transaction.assetBalance.upsert({
    where,
    create: { userId, asset, available: fixed(available), locked: fixed(locked) },
    update: { available: fixed(Math.max(0, available)), locked: fixed(Math.max(0, locked)) },
  });
}

export function liquidationPrice(
  entryPrice: number,
  leverage: number,
  side: "LONG" | "SHORT",
): number {
  const maintenanceMarginRate = 0.005;
  return round8(side === "LONG"
    ? (entryPrice * Math.max(0, 1 - 1 / leverage)) / (1 - maintenanceMarginRate)
    : (entryPrice * (1 + 1 / leverage)) / (1 + maintenanceMarginRate));
}

export async function increasePosition(
  transaction: Prisma.TransactionClient,
  input: {
    userId: number;
    symbol: string;
    side: "LONG" | "SHORT";
    quantity: number;
    price: number;
    margin: number;
  },
) {
  const where = { userId_symbol: { userId: input.userId, symbol: input.symbol } };
  const current = await transaction.perpPosition.findUnique({ where });
  if (current && current.side !== input.side) {
    throw new Error("Close the existing position before opening the opposite side");
  }

  const oldQuantity = Number(current?.quantity ?? 0);
  const oldMargin = Number(current?.margin ?? 0);
  const quantity = round8(oldQuantity + input.quantity);
  const margin = round8(oldMargin + input.margin);
  const entryPrice = round8(
    ((oldQuantity * Number(current?.entryPrice ?? 0)) + (input.quantity * input.price)) / quantity,
  );
  const leverage = round8((quantity * entryPrice) / margin);

  return transaction.perpPosition.upsert({
    where,
    create: {
      ...where.userId_symbol,
      side: input.side,
      quantity: fixed(quantity),
      entryPrice: fixed(entryPrice),
      margin: fixed(margin),
      leverage: fixed(leverage),
      liquidationPrice: fixed(liquidationPrice(entryPrice, leverage, input.side)),
    },
    update: {
      quantity: fixed(quantity),
      entryPrice: fixed(entryPrice),
      margin: fixed(margin),
      leverage: fixed(leverage),
      liquidationPrice: fixed(liquidationPrice(entryPrice, leverage, input.side)),
    },
  });
}

export function positionPnl(
  position: { side: "LONG" | "SHORT"; quantity: unknown; entryPrice: unknown },
  price: number,
): number {
  const quantity = Number(position.quantity);
  const entryPrice = Number(position.entryPrice);
  return round8(position.side === "LONG"
    ? (price - entryPrice) * quantity
    : (entryPrice - price) * quantity);
}

export async function closePosition(
  transaction: Prisma.TransactionClient,
  position: {
    id: number;
    userId: number;
    symbol: string;
    side: "LONG" | "SHORT";
    quantity: unknown;
    entryPrice: unknown;
    margin: unknown;
    leverage?: unknown;
  },
  price: number,
  liquidation = false,
  liquidationLoss?: number,
) {
  const pnl = positionPnl(position, price);
  const margin = Number(position.margin);
  const payout = round8(Math.max(0, margin + pnl));
  const cancelledOrderIds: number[] = [];
  if (liquidation) {
    const orders = await transaction.order.findMany({
      where: {
        user: position.userId,
        StockName: position.symbol,
        marketType: "PERP",
        status: "OPEN",
      },
    });
    for (const order of orders) {
      if (order.price === null) {
        throw new Error(`Open perp order ${order.id} is missing its limit price`);
      }
      const remaining = Number(order.remaining);
      const refund = (remaining * Number(order.price)) / order.leverage;
      await changeBalance(transaction, position.userId, "USDT", refund, -refund);
      await transaction.order.update({
        where: { id: order.id },
        data: { status: "CANCELLED", remaining: "0" },
      });
      cancelledOrderIds.push(order.id);
    }
  }
  const stock = await transaction.stocks.findUnique({ where: { StockSymbol: position.symbol } });
  if (!stock) throw new Error(`Unknown market while closing ${position.symbol}`);
  const closeSide = position.side === "LONG" ? "ASK" : "BID";
  const closeOrder = await transaction.order.create({
    data: {
      user: position.userId,
      Stock: stock.id,
      StockName: position.symbol,
      category: "MARKET",
      type: closeSide,
      status: "FILLED",
      marketType: "PERP",
      price: fixed(price),
      volume: fixed(Number(position.quantity)),
      remaining: "0",
      leverage: Math.max(1, Math.min(20, Math.round(Number(position.leverage ?? 1)))),
    },
  });
  await transaction.fills.create({
    data: {
      order: closeOrder.id,
      user: position.userId,
      asset: position.symbol,
      category: "MARKET",
      type: closeSide,
      legacyQuantity: Math.trunc(Number(position.quantity)),
      quantity: fixed(Number(position.quantity)),
      price: fixed(price),
      orginalOrderId: 0,
      marketType: "PERP",
    },
  });
  await changeBalance(transaction, position.userId, "USDT", payout, 0);
  if (liquidation) {
    await transaction.liquidationEvent.create({
      data: {
        userId: position.userId,
        symbol: position.symbol,
        side: position.side,
        quantity: fixed(Number(position.quantity)),
        price: fixed(price),
        loss: fixed(liquidationLoss ?? Math.max(0, margin - payout)),
      },
    });
  }
  await transaction.perpPosition.delete({ where: { id: position.id } });
  return { pnl, payout, cancelledOrderIds };
}

export async function liquidateAtMark(
  transaction: Prisma.TransactionClient,
  symbol: string,
  price: number,
) {
  const positions = await transaction.perpPosition.findMany({ where: { symbol } });
  const liquidated: Array<{ userId: number; cancelledOrderIds: number[] }> = [];
  for (const position of positions) {
    const liquidationPrice = Number(position.liquidationPrice);
    const breached = position.side === "LONG"
      ? price <= liquidationPrice
      : price >= liquidationPrice;
    if (breached) {
      const result = await closePosition(transaction, position, price, true);
      liquidated.push({ userId: position.userId, cancelledOrderIds: result.cancelledOrderIds });
    }
  }
  return liquidated;
}
