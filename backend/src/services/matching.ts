export type MarketType = "SPOT" | "PERP";
export type Side = "BID" | "ASK";

export interface BookOrder {
  id: number;
  userId: number;
  symbol: string;
  marketType: MarketType;
  side: Side;
  category: "LIMIT" | "MARKET";
  price: number | null;
  remaining: number;
  leverage: number;
  createdAt: number;
  synthetic?: boolean;
}

export interface Trade {
  maker: BookOrder;
  price: number;
  quantity: number;
}

export interface MatchPlan {
  trades: Trade[];
  remaining: number;
  makerUpdates: Map<number, number>;
}

const precision = 100_000_000;
const round = (value: number) => Math.round(value * precision) / precision;

export class MatchingEngine {
  private readonly books = new Map<string, BookOrder[]>();
  private readonly lastPrices = new Map<string, number>();

  private key(symbol: string, marketType: MarketType): string {
    return `${marketType}:${symbol}`;
  }

  add(order: BookOrder): void {
    if (order.remaining <= 0 || order.category !== "LIMIT" || order.price === null) return;
    const key = this.key(order.symbol, order.marketType);
    this.books.set(key, [...(this.books.get(key) ?? []), order]);
  }

  remove(orderId: number, symbol: string, marketType: MarketType): BookOrder | undefined {
    const key = this.key(symbol, marketType);
    const book = this.books.get(key) ?? [];
    const removed = book.find((entry) => entry.id === orderId);
    this.books.set(key, book.filter((entry) => entry.id !== orderId));
    return removed;
  }

  plan(incoming: BookOrder): MatchPlan {
    const makers = [...(this.books.get(this.key(incoming.symbol, incoming.marketType)) ?? [])]
      .filter((maker) => maker.side !== incoming.side && maker.userId !== incoming.userId)
      .sort((left, right) => {
        const priceOrder = left.side === "ASK"
          ? (left.price ?? 0) - (right.price ?? 0)
          : (right.price ?? 0) - (left.price ?? 0);
        return priceOrder || left.createdAt - right.createdAt || left.id - right.id;
      });

    let remaining = incoming.remaining;
    const trades: Trade[] = [];
    const makerUpdates = new Map<number, number>();

    for (const maker of makers) {
      if (remaining <= 0) break;
      if (incoming.category === "LIMIT" && incoming.price !== null) {
        const crosses = incoming.side === "BID"
          ? (maker.price ?? Number.POSITIVE_INFINITY) <= incoming.price
          : (maker.price ?? Number.NEGATIVE_INFINITY) >= incoming.price;
        if (!crosses) break;
      }

      const makerRemaining = makerUpdates.get(maker.id) ?? maker.remaining;
      const quantity = round(Math.min(remaining, makerRemaining));
      if (quantity <= 0) continue;

      trades.push({ maker, price: maker.price!, quantity });
      makerUpdates.set(maker.id, round(makerRemaining - quantity));
      remaining = round(remaining - quantity);
    }

    return { trades, remaining, makerUpdates };
  }

  commit(incoming: BookOrder, plan: MatchPlan): void {
    const key = this.key(incoming.symbol, incoming.marketType);
    const book = this.books.get(key) ?? [];
    for (const [id, remaining] of plan.makerUpdates) {
      const maker = book.find((entry) => entry.id === id);
      if (maker) maker.remaining = remaining;
    }
    this.books.set(key, book.filter((entry) => entry.remaining > 0));

    for (const trade of plan.trades) {
      this.lastPrices.set(key, trade.price);
    }

    if (incoming.category === "LIMIT" && plan.remaining > 0) {
      this.add({ ...incoming, remaining: plan.remaining });
    }
  }

  setLastPrice(symbol: string, marketType: MarketType, price: number): void {
    if (Number.isFinite(price) && price > 0) {
      this.lastPrices.set(this.key(symbol, marketType), price);
    }
  }

  getLastPrice(symbol: string, marketType: MarketType): number | undefined {
    return this.lastPrices.get(this.key(symbol, marketType));
  }

  depth(symbol: string, marketType: MarketType) {
    const book = this.books.get(this.key(symbol, marketType)) ?? [];
    const aggregate = (side: Side) => {
      const levels = new Map<number, number>();
      for (const order of book) {
        if (order.side === side && order.price !== null) {
          levels.set(order.price, round((levels.get(order.price) ?? 0) + order.remaining));
        }
      }
      return [...levels.entries()]
        .map(([price, quantity]) => ({ price, quantity }))
        .sort((left, right) => side === "BID" ? right.price - left.price : left.price - right.price);
    };

    return { bids: aggregate("BID"), asks: aggregate("ASK") };
  }
}

export const matchingEngine = new MatchingEngine();

export const round8 = round;
