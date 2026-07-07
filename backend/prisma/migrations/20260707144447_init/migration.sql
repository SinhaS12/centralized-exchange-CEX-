-- AlterTable
CREATE SEQUENCE fills_id_seq;
ALTER TABLE "Fills" ALTER COLUMN "id" SET DEFAULT nextval('fills_id_seq');
ALTER SEQUENCE fills_id_seq OWNED BY "Fills"."id";

-- AlterTable
CREATE SEQUENCE order_id_seq;
ALTER TABLE "Order" ALTER COLUMN "id" SET DEFAULT nextval('order_id_seq');
ALTER SEQUENCE order_id_seq OWNED BY "Order"."id";

-- AlterTable
CREATE SEQUENCE stocks_id_seq;
ALTER TABLE "Stocks" ALTER COLUMN "id" SET DEFAULT nextval('stocks_id_seq');
ALTER SEQUENCE stocks_id_seq OWNED BY "Stocks"."id";

-- AlterTable
CREATE SEQUENCE user_id_seq;
ALTER TABLE "User" ALTER COLUMN "id" SET DEFAULT nextval('user_id_seq');
ALTER SEQUENCE user_id_seq OWNED BY "User"."id";
