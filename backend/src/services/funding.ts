import { prisma } from "../db/db.ts";
import { matchingEngine } from "./matching.ts";
import { closePosition, fixed, liquidationPrice } from "./settlement.ts";
import { serialize } from "./tradingQueue.ts";

export const FUNDING_RATE = 0.0001;
export const FUNDING_INTERVAL_MS = 8 * 60 * 60 * 1000;
const schedulerIntervalMs = 60_000;

function nextBoundary(now: number): number {
  return (Math.floor(now / FUNDING_INTERVAL_MS) + 1) * FUNDING_INTERVAL_MS;
}

async function settleSymbol(symbol: string, settlementAt: Date) {
  const markPrice = matchingEngine.getLastPrice(symbol, "PERP");
  if (!markPrice) return [];

  return prisma.$transaction(async (transaction) => {
    const cancelledOrderIds: number[] = [];
    const prior = await transaction.fundingSettlement.findUnique({
      where: { symbol_settlementAt: { symbol, settlementAt } },
    });
    if (prior) return;

    await transaction.fundingSettlement.create({ data: { symbol, settlementAt } });
    const positions = await transaction.perpPosition.findMany({
      where: { symbol, updatedAt: { lt: settlementAt } },
    });
    for (const position of positions) {
      const notional = Number(position.quantity) * markPrice;
      const signedAmount = notional * FUNDING_RATE * (position.side === "LONG" ? -1 : 1);
      const margin = Number(position.margin) + signedAmount;
      const leverage = margin > 0 ? notional / margin : 20;
      const nextLiq = liquidationPrice(Number(position.entryPrice), leverage, position.side);
      await transaction.fundingPayment.create({
        data: {
          userId: position.userId,
          symbol,
          amount: fixed(signedAmount),
          rate: fixed(FUNDING_RATE),
          createdAt: settlementAt,
        },
      });

      if (margin <= 0) {
        const closed = await closePosition(
          transaction,
          { ...position, margin: fixed(margin) },
          markPrice,
          true,
          Number(position.margin),
        );
        cancelledOrderIds.push(...closed.cancelledOrderIds);
        continue;
      }

      await transaction.perpPosition.update({
        where: { id: position.id },
        data: { margin: fixed(margin), leverage: fixed(leverage), liquidationPrice: fixed(nextLiq) },
      });

      const breached = position.side === "LONG"
        ? markPrice <= nextLiq
        : markPrice >= nextLiq;
      if (breached) {
        const closed = await closePosition(transaction, { ...position, margin: fixed(margin) }, markPrice, true);
        cancelledOrderIds.push(...closed.cancelledOrderIds);
      }
    }
    return cancelledOrderIds;
  });
}

async function settleDueFunding() {
  const symbols = await prisma.stocks.findMany({ select: { StockSymbol: true } });
  const now = Date.now();
  for (const { StockSymbol: symbol } of symbols) {
    const latest = await prisma.fundingSettlement.findFirst({
      where: { symbol },
      orderBy: { settlementAt: "desc" },
      select: { settlementAt: true },
    });
    let settlementTime = latest
      ? latest.settlementAt.getTime() + FUNDING_INTERVAL_MS
      : Math.floor(now / FUNDING_INTERVAL_MS) * FUNDING_INTERVAL_MS;
    while (settlementTime <= now) {
      const cancelledOrderIds = await serialize(() => settleSymbol(symbol, new Date(settlementTime)));
      for (const orderId of cancelledOrderIds ?? []) {
        matchingEngine.remove(orderId, symbol, "PERP");
      }
      settlementTime += FUNDING_INTERVAL_MS;
    }
  }
}

export function startFundingScheduler() {
  const run = () => {
    void settleDueFunding().catch((error: unknown) => {
      console.error("Funding settlement failed", error);
    });
  };
  run();
  setInterval(run, schedulerIntervalMs).unref();
}

export function nextFundingTime(now = Date.now()): Date {
  return new Date(nextBoundary(now));
}

export async function fundingRateFor(symbol: string) {
  const latest = await prisma.fundingPayment.findFirst({
    where: { symbol },
    orderBy: { createdAt: "desc" },
    select: { rate: true, createdAt: true },
  });
  return {
    rate: latest ? Number(latest.rate) : FUNDING_RATE,
    intervalMs: FUNDING_INTERVAL_MS,
    nextFundingAt: nextFundingTime().toISOString(),
  };
}
