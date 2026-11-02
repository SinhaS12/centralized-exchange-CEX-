import { describe, expect, test } from "bun:test";
import { MatchingEngine, type BookOrder } from "./matching.ts";

function order(input: Partial<BookOrder> & Pick<BookOrder, "id" | "side" | "price">): BookOrder {
  return {
    userId: input.userId ?? input.id,
    symbol: "BTC-USDT",
    marketType: "SPOT",
    category: "LIMIT",
    remaining: 1,
    leverage: 1,
    createdAt: input.createdAt ?? input.id,
    ...input,
  };
}

describe("MatchingEngine", () => {
  test("matches at the resting order price and consumes the best ask first", () => {
    const engine = new MatchingEngine();
    engine.add(order({ id: 1, side: "ASK", price: 102 }));
    engine.add(order({ id: 2, side: "ASK", price: 100 }));

    const plan = engine.plan(order({ id: 3, userId: 3, side: "BID", price: 101, remaining: 1.5 }));

    expect(plan.trades).toEqual([
      { maker: expect.objectContaining({ id: 2 }), price: 100, quantity: 1 },
    ]);
    expect(plan.remaining).toBe(0.5);
  });

  test("uses price-time priority and skips orders from the same user", () => {
    const engine = new MatchingEngine();
    engine.add(order({ id: 1, userId: 9, side: "ASK", price: 100, createdAt: 1 }));
    engine.add(order({ id: 2, userId: 2, side: "ASK", price: 100, createdAt: 3 }));
    engine.add(order({ id: 3, userId: 3, side: "ASK", price: 100, createdAt: 2 }));

    const plan = engine.plan(order({ id: 4, userId: 9, side: "BID", price: 100 }));

    expect(plan.trades.map((trade) => trade.maker.id)).toEqual([3]);
  });

  test("does not execute a limit order beyond its limit price", () => {
    const engine = new MatchingEngine();
    engine.add(order({ id: 1, side: "ASK", price: 105 }));

    const plan = engine.plan(order({ id: 2, side: "BID", price: 104 }));

    expect(plan.trades).toHaveLength(0);
    expect(plan.remaining).toBe(1);
  });

  test("aggregates depth and records the last matched price on commit", () => {
    const engine = new MatchingEngine();
    engine.add(order({ id: 1, side: "ASK", price: 100, remaining: 2 }));
    engine.add(order({ id: 2, side: "ASK", price: 100, remaining: 3 }));
    const incoming = order({ id: 3, side: "BID", price: 100, remaining: 4 });
    const plan = engine.plan(incoming);

    engine.commit(incoming, plan);

    expect(engine.depth("BTC-USDT", "SPOT").asks).toEqual([{ price: 100, quantity: 1 }]);
    expect(engine.getLastPrice("BTC-USDT", "SPOT")).toBe(100);
  });

  test("keeps spot and perp order books isolated", () => {
    const engine = new MatchingEngine();
    engine.add(order({ id: 1, side: "ASK", price: 100, marketType: "SPOT" }));
    engine.add(order({ id: 2, side: "ASK", price: 100, marketType: "PERP" }));

    const plan = engine.plan(order({ id: 3, side: "BID", price: 100, marketType: "PERP" }));

    expect(plan.trades.map((trade) => trade.maker.id)).toEqual([2]);
  });
});
