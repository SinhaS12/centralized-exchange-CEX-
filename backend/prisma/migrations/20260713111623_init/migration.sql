/*
  Warnings:

  - The values [bid,ask] on the enum `TYPE` will be removed. If these variants are still used in the database, this will fail.
  - A unique constraint covering the columns `[StockSymbol]` on the table `Stocks` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `Quantity` to the `Fills` table without a default value. This is not possible if the table is not empty.
  - Added the required column `asset` to the `Fills` table without a default value. This is not possible if the table is not empty.
  - Added the required column `category` to the `Fills` table without a default value. This is not possible if the table is not empty.
  - Added the required column `orginalOrderId` to the `Fills` table without a default value. This is not possible if the table is not empty.
  - Added the required column `price` to the `Fills` table without a default value. This is not possible if the table is not empty.
  - Added the required column `type` to the `Fills` table without a default value. This is not possible if the table is not empty.
  - Added the required column `status` to the `Order` table without a default value. This is not possible if the table is not empty.
  - Made the column `amount` on table `Order` required. This step will fail if there are existing NULL values in that column.
  - Made the column `volume` on table `Order` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `StockSymbol` to the `Stocks` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "STATUS" AS ENUM ('OPEN', 'FILLED', 'CANCELLED');

-- AlterEnum
BEGIN;
CREATE TYPE "TYPE_new" AS ENUM ('BID', 'ASK');
ALTER TABLE "Order" ALTER COLUMN "type" TYPE "TYPE_new" USING ("type"::text::"TYPE_new");
ALTER TABLE "Fills" ALTER COLUMN "type" TYPE "TYPE_new" USING ("type"::text::"TYPE_new");
ALTER TYPE "TYPE" RENAME TO "TYPE_old";
ALTER TYPE "TYPE_new" RENAME TO "TYPE";
DROP TYPE "public"."TYPE_old";
COMMIT;

-- AlterTable
ALTER TABLE "Fills" ADD COLUMN     "Quantity" INTEGER NOT NULL,
ADD COLUMN     "asset" TEXT NOT NULL,
ADD COLUMN     "category" "CATEGORY" NOT NULL,
ADD COLUMN     "orginalOrderId" INTEGER NOT NULL,
ADD COLUMN     "price" INTEGER NOT NULL,
ADD COLUMN     "type" "TYPE" NOT NULL;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "status" "STATUS" NOT NULL,
ALTER COLUMN "amount" SET NOT NULL,
ALTER COLUMN "volume" SET NOT NULL;

-- AlterTable
ALTER TABLE "Stocks" ADD COLUMN     "StockSymbol" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Stocks_StockSymbol_key" ON "Stocks"("StockSymbol");
