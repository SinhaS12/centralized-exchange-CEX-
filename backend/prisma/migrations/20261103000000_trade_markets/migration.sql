CREATE TYPE "MARKET_TYPE" AS ENUM ('SPOT', 'PERP');
CREATE TYPE "POSITION_SIDE" AS ENUM ('LONG', 'SHORT');

ALTER TABLE "Order"
  ADD COLUMN "marketType" "MARKET_TYPE" NOT NULL DEFAULT 'SPOT',
  ADD COLUMN "price" DECIMAL(30, 8),
  ADD COLUMN "remaining" DECIMAL(30, 8) NOT NULL DEFAULT 0,
  ADD COLUMN "leverage" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "reduceOnly" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Order" SET "status" = 'CANCELLED', "remaining" = 0 WHERE "status" = 'OPEN';
ALTER TABLE "Order"
  ALTER COLUMN "volume" TYPE DECIMAL(30, 8)
  USING ROUND("volume", 8)::DECIMAL(30, 8);

ALTER TABLE "Fills"
  ADD COLUMN "quantity" DECIMAL(30, 8),
  ADD COLUMN "marketType" "MARKET_TYPE" NOT NULL DEFAULT 'SPOT',
  ALTER COLUMN "price" TYPE DECIMAL(30, 8) USING "price"::DECIMAL(30, 8);

UPDATE "Fills" SET "quantity" = "Quantity";
ALTER TABLE "Fills" ALTER COLUMN "quantity" SET NOT NULL;

CREATE INDEX "Order_Stock_marketType_status_type_price_createdAt_idx"
  ON "Order"("Stock", "marketType", "status", "type", "price", "createdAt");
CREATE INDEX "Order_user_status_createdAt_idx"
  ON "Order"("user", "status", "createdAt");
CREATE INDEX "Fills_asset_marketType_createdAt_idx"
  ON "Fills"("asset", "marketType", "createdAt");

CREATE TABLE "AssetBalance" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "asset" TEXT NOT NULL,
  "available" DECIMAL(30, 8) NOT NULL DEFAULT 0,
  "locked" DECIMAL(30, 8) NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AssetBalance_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AssetBalance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AssetBalance_userId_asset_key" ON "AssetBalance"("userId", "asset");

INSERT INTO "AssetBalance" ("userId", "asset", "available", "locked", "updatedAt")
SELECT "User"."id", seed."asset", seed."available", 0, CURRENT_TIMESTAMP
FROM "User"
CROSS JOIN (VALUES
  ('USDT', 100000::DECIMAL(30, 8)),
  ('BTC', 1::DECIMAL(30, 8)),
  ('ETH', 10::DECIMAL(30, 8))
) AS seed("asset", "available");

CREATE TABLE "PerpPosition" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "symbol" TEXT NOT NULL,
  "side" "POSITION_SIDE" NOT NULL,
  "quantity" DECIMAL(30, 8) NOT NULL,
  "entryPrice" DECIMAL(30, 8) NOT NULL,
  "margin" DECIMAL(30, 8) NOT NULL,
  "leverage" DECIMAL(10, 4) NOT NULL,
  "liquidationPrice" DECIMAL(30, 8) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PerpPosition_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PerpPosition_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PerpPosition_userId_symbol_key" ON "PerpPosition"("userId", "symbol");
CREATE INDEX "PerpPosition_symbol_side_idx" ON "PerpPosition"("symbol", "side");

CREATE TABLE "FundingPayment" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "symbol" TEXT NOT NULL,
  "amount" DECIMAL(30, 8) NOT NULL,
  "rate" DECIMAL(12, 8) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FundingPayment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FundingPayment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "FundingPayment_symbol_createdAt_idx" ON "FundingPayment"("symbol", "createdAt");
CREATE INDEX "FundingPayment_userId_createdAt_idx" ON "FundingPayment"("userId", "createdAt");

CREATE TABLE "FundingSettlement" (
  "id" SERIAL NOT NULL,
  "symbol" TEXT NOT NULL,
  "settlementAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FundingSettlement_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FundingSettlement_symbol_settlementAt_key"
  ON "FundingSettlement"("symbol", "settlementAt");

CREATE TABLE "LiquidationEvent" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "symbol" TEXT NOT NULL,
  "side" "POSITION_SIDE" NOT NULL,
  "quantity" DECIMAL(30, 8) NOT NULL,
  "price" DECIMAL(30, 8) NOT NULL,
  "loss" DECIMAL(30, 8) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LiquidationEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LiquidationEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "LiquidationEvent_symbol_createdAt_idx" ON "LiquidationEvent"("symbol", "createdAt");
CREATE INDEX "LiquidationEvent_userId_createdAt_idx" ON "LiquidationEvent"("userId", "createdAt");
