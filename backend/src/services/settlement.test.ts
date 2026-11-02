import { describe, expect, test } from "bun:test";
import { liquidationPrice, positionPnl } from "./settlement.ts";

describe("isolated perp settlement math", () => {
  test("calculates long and short PnL with the correct sign", () => {
    expect(positionPnl({ side: "LONG", quantity: 2, entryPrice: 100 }, 110)).toBe(20);
    expect(positionPnl({ side: "SHORT", quantity: 2, entryPrice: 100 }, 110)).toBe(-20);
  });

  test("calculates leverage-aware liquidation thresholds", () => {
    expect(liquidationPrice(100, 2, "LONG")).toBe(50.25125628);
    expect(liquidationPrice(100, 2, "SHORT")).toBe(149.25373134);
    expect(liquidationPrice(100, 1, "LONG")).toBe(0);
  });
});
