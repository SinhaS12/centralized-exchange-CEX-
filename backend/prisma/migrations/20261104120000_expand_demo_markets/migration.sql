INSERT INTO "AssetBalance" ("userId", "asset", "available", "locked", "updatedAt")
SELECT "User"."id", seed."asset", seed."available", 0, CURRENT_TIMESTAMP
FROM "User"
CROSS JOIN (VALUES
  ('SOL', 100::DECIMAL(30, 8)),
  ('BNB', 10::DECIMAL(30, 8)),
  ('XRP', 1000::DECIMAL(30, 8)),
  ('ADA', 1000::DECIMAL(30, 8)),
  ('DOGE', 10000::DECIMAL(30, 8))
) AS seed("asset", "available")
ON CONFLICT ("userId", "asset") DO NOTHING;
