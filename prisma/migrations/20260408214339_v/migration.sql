
ALTER TYPE "NotificationType" ADD VALUE 'DISBURSEMENT_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE 'DISBURSEMENT_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'DISBURSEMENT_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE 'MEETING_REMINDER';

-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'DISBURSEMENT';

-- DropIndex
DROP INDEX "group_memberships_userId_key";

-- AlterTable
ALTER TABLE "event_contributions" ADD COLUMN     "externalRef" TEXT;

-- CreateIndex
CREATE INDEX "contributions_externalRef_idx" ON "contributions"("externalRef");

-- CreateIndex
CREATE INDEX "event_contributions_externalRef_idx" ON "event_contributions"("externalRef");

-- CreateIndex
CREATE INDEX "group_memberships_userId_idx" ON "group_memberships"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "group_memberships_groupId_userId_key" ON "group_memberships"("groupId", "userId");

-- CreateIndex
CREATE INDEX "loan_repayments_externalRef_idx" ON "loan_repayments"("externalRef");
