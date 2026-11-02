import "dotenv/config";
import express from "express";
import { prisma } from "./src/db/db.ts";
import orderRouter, { initializeOrderBook } from "./src/route/Order.ts";
import userRouter from "./src/route/User.ts";
import { startFundingScheduler } from "./src/services/funding.ts";

const app = express();
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be a valid TCP port");
}

app.use(express.json({ limit: "32kb" }));
app.use((req, res, next) => {
  const origin = req.get("origin");
  const allowedOrigin = process.env.FRONTEND_ORIGIN ?? "http://localhost:5173";
  if (origin === allowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  return next();
});

app.get("/health", (_req, res) => res.json({ success: true }));
app.use("/api", userRouter);
app.use("/api", orderRouter);
app.use((_req, res) => res.status(404).json({ success: false, message: "Route not found" }));

async function start() {
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET must be configured");
  await prisma.$connect();
  await initializeOrderBook();
  startFundingScheduler();
  app.listen(port, () => console.log(`CEX API listening on port ${port}`));
}

start().catch((error: unknown) => {
  console.error("Unable to start CEX API", error);
  process.exitCode = 1;
});
