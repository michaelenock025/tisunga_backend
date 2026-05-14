
ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "totalBorrowed" DECIMAL(15,2) NOT NULL DEFAULT 0;

-- Back-fill totalBorrowed from currently active/overdue loans
UPDATE "groups" g
SET "totalBorrowed" = COALESCE((
  SELECT SUM(l."principalAmount")
  FROM "loans" l
  WHERE l."groupId" = g.id
    AND l."status" IN ('ACTIVE', 'OVERDUE')
), 0);
