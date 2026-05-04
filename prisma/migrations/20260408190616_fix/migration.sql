
-- AlterEnum
ALTER TYPE "DisbursementStatus" ADD VALUE 'APPROVED';

-- AlterEnum
BEGIN;
CREATE TYPE "NotificationType_new" AS ENUM ('LOAN_APPROVED', 'LOAN_REJECTED', 'LOAN_DUE', 'CONTRIBUTION_RECEIVED', 'EVENT_CREATED', 'EVENT_CLOSED', 'MEMBER_JOINED', 'GENERAL');
ALTER TABLE "notifications" ALTER COLUMN "type" TYPE "NotificationType_new" USING ("type"::text::"NotificationType_new");
ALTER TYPE "NotificationType" RENAME TO "NotificationType_old";
ALTER TYPE "NotificationType_new" RENAME TO "NotificationType";
DROP TYPE "NotificationType_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "TransactionType_new" AS ENUM ('CONTRIBUTION', 'LOAN_DISBURSEMENT', 'LOAN_REPAYMENT', 'EVENT_CONTRIBUTION', 'WITHDRAWAL');
ALTER TABLE "transactions" ALTER COLUMN "type" TYPE "TransactionType_new" USING ("type"::text::"TransactionType_new");
ALTER TYPE "TransactionType" RENAME TO "TransactionType_old";
ALTER TYPE "TransactionType_new" RENAME TO "TransactionType";
DROP TYPE "TransactionType_old";
COMMIT;

-- DropIndex
DROP INDEX "group_memberships_groupId_userId_key";

-- AlterTable
ALTER TABLE "event_contributions" DROP COLUMN "externalRef";
