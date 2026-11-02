import { z } from "zod";

export const order_val = z.object({
  symbol: z.string().trim().min(3).max(20).transform((value) => value.toUpperCase()),
  marketType: z.enum(["SPOT", "PERP"]).default("SPOT"),
  category: z.enum(["LIMIT", "MARKET"]),
  type: z.enum(["BID", "ASK", "bid", "ask", "buy", "sell"]).transform((value) =>
    value === "BID" || value === "bid" || value === "buy" ? "BID" : "ASK",
  ),
  price: z.number().positive().finite().optional(),
  volume: z.number().positive().finite(),
  leverage: z.number().int().min(1).max(20).default(1),
}).superRefine((value, context) => {
  if (value.category === "LIMIT" && value.price === undefined) {
    context.addIssue({
      code: "custom",
      path: ["price"],
      message: "A positive price is required for limit orders",
    });
  }
  if (value.marketType === "SPOT" && value.leverage !== 1) {
    context.addIssue({
      code: "custom",
      path: ["leverage"],
      message: "Spot orders do not support leverage",
    });
  }
});

export const closePosition_val = z.object({
  symbol: z.string().trim().min(3).max(20).transform((value) => value.toUpperCase()),
});
