import bcrypt from "bcrypt";
import express from "express";
import jwt from "jsonwebtoken";
import { Prisma } from "../generated/prisma/client";
import { prisma } from "../db/db.ts";
import { authenticatedUserId, middleware } from "../middleware/middleware.ts";
import { signin_val, signup_val } from "../validation/User_Val.ts";

const router = express.Router();
const startingBalances = [
  { asset: "USDT", available: "100000" },
  { asset: "BTC", available: "1" },
  { asset: "ETH", available: "10" },
];

function tokenFor(id: number, email: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET must be configured");
  return jwt.sign({ id, email }, secret, { expiresIn: "12h" });
}

function bcryptRounds(): number {
  const value = Number(process.env.BCRYPT_ROUNDS ?? process.env.BCRYPT_HASH ?? 12);
  if (!Number.isInteger(value) || value < 10 || value > 31) {
    throw new Error("BCRYPT_ROUNDS must be an integer between 10 and 31");
  }
  return value;
}

router.post("/signup", async (req, res) => {
  const parsed = signup_val.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: "Invalid signup details", issues: parsed.error.issues });
  }

  try {
    const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (existing) {
      return res.status(409).json({ success: false, message: "An account with this email already exists" });
    }

    const password = await bcrypt.hash(parsed.data.password, bcryptRounds());
    const user = await prisma.$transaction(async (transaction) => {
      const created = await transaction.user.create({
        data: {
          username: parsed.data.username,
          email: parsed.data.email,
          password,
        },
        select: { id: true, username: true, email: true },
      });
      await transaction.assetBalance.createMany({
        data: startingBalances.map((balance) => ({
          userId: created.id,
          asset: balance.asset,
          available: balance.available,
        })),
      });
      return created;
    });

    return res.status(201).json({
      success: true,
      message: "Account created",
      details: user,
      token: tokenFor(user.id, user.email),
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return res.status(409).json({ success: false, message: "An account with this email already exists" });
    }
    console.error("Signup failed", error);
    return res.status(500).json({ success: false, message: "Unable to create account" });
  }
});

router.post("/login", async (req, res) => {
  const parsed = signin_val.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: "Invalid login details" });
  }

  try {
    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (!user || !(await bcrypt.compare(parsed.data.password, user.password))) {
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }
    return res.status(200).json({
      success: true,
      message: "Signed in",
      details: { id: user.id, username: user.username, email: user.email },
      token: tokenFor(user.id, user.email),
    });
  } catch (error) {
    console.error("Login failed", error);
    return res.status(500).json({ success: false, message: "Unable to sign in" });
  }
});

router.get("/account", middleware, async (_req, res) => {
  try {
    const userId = authenticatedUserId(res);
    const [user, balances, positions, fundingPayments, liquidations, fills] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { id: true, username: true, email: true } }),
      prisma.assetBalance.findMany({ where: { userId }, orderBy: { asset: "asc" } }),
      prisma.perpPosition.findMany({ where: { userId }, orderBy: { symbol: "asc" } }),
      prisma.fundingPayment.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 20 }),
      prisma.liquidationEvent.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 20 }),
      prisma.fills.findMany({ where: { user: userId }, orderBy: { createdAt: "desc" }, take: 50 }),
    ]);
    if (!user) return res.status(404).json({ success: false, message: "Account not found" });
    return res.json({
      success: true,
      details: {
        user,
        balances: balances.map((balance) => ({
          asset: balance.asset,
          available: Number(balance.available),
          locked: Number(balance.locked),
        })),
        positions: positions.map((position) => ({
          symbol: position.symbol,
          side: position.side,
          quantity: Number(position.quantity),
          entryPrice: Number(position.entryPrice),
          margin: Number(position.margin),
          leverage: Number(position.leverage),
          liquidationPrice: Number(position.liquidationPrice),
        })),
        fundingPayments: fundingPayments.map((payment) => ({
          id: payment.id,
          symbol: payment.symbol,
          amount: Number(payment.amount),
          rate: Number(payment.rate),
          createdAt: payment.createdAt,
        })),
        liquidations: liquidations.map((event) => ({
          id: event.id,
          symbol: event.symbol,
          side: event.side,
          quantity: Number(event.quantity),
          price: Number(event.price),
          loss: Number(event.loss),
          createdAt: event.createdAt,
        })),
        fills: fills.map((fill) => ({
          id: fill.id,
          symbol: fill.asset,
          marketType: fill.marketType,
          category: fill.category,
          side: fill.type,
          price: Number(fill.price),
          quantity: Number(fill.quantity),
          createdAt: fill.createdAt,
        })),
      },
    });
  } catch (error) {
    console.error("Account lookup failed", error);
    return res.status(500).json({ success: false, message: "Unable to load account" });
  }
});

export default router;
