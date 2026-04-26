/*
  Warnings:

  - You are about to drop the column `paymentMethod` on the `contributions` table. All the data in the column will be lost.
  - You are about to drop the column `visibility` on the `groups` table. All the data in the column will be lost.
  - You are about to drop the `join_requests` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "DisbursementStatus" AS ENUM ('PENDING', 'APPROVED', 'PROCESSING', 'COMPLETED', 'REJECTED');

-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'EXCUSED');

-- AlterEnum
ALTER TYPE "MemberRole" ADD VALUE 'TREASURER';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'DISBURSEMENT_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE 'DISBURSEMENT_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'DISBURSEMENT_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE 'MEETING_REMINDER';

-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'DISBURSEMENT';

-- DropForeignKey
ALTER TABLE "join_requests" DROP CONSTRAINT "join_requests_groupId_fkey";

-- DropIndex
DROP INDEX "contributions_transactionRef_idx";

-- DropIndex
DROP INDEX "events_status_idx";

-- DropIndex
DROP INDEX "groups_groupCode_idx";

-- DropIndex
DROP INDEX "groups_visibility_idx";

-- AlterTable
ALTER TABLE "contributions" DROP COLUMN "paymentMethod";

-- AlterTable
ALTER TABLE "event_contributions" ADD COLUMN     "externalRef" TEXT;

-- AlterTable
ALTER TABLE "groups" DROP COLUMN "visibility";

-- AlterTable
ALTER TABLE "loans" ADD COLUMN     "purpose" TEXT;

-- DropTable
DROP TABLE "join_requests";

-- CreateTable
CREATE TABLE "meetings" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "agenda" TEXT,
    "location" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" "MeetingStatus" NOT NULL DEFAULT 'SCHEDULED',
    "notifiedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_attendance" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'ABSENT',
    "markedAt" TIMESTAMP(3),
    "markedBy" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disbursements" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "totalAmount" DECIMAL(15,2) NOT NULL,
    "status" "DisbursementStatus" NOT NULL DEFAULT 'PENDING',
    "rejectedReason" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "memberShares" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "disbursements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meetings_groupId_idx" ON "meetings"("groupId");

-- CreateIndex
CREATE INDEX "meetings_scheduledAt_idx" ON "meetings"("scheduledAt");

-- CreateIndex
CREATE INDEX "meeting_attendance_meetingId_idx" ON "meeting_attendance"("meetingId");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_attendance_meetingId_userId_key" ON "meeting_attendance"("meetingId", "userId");

-- CreateIndex
CREATE INDEX "disbursements_groupId_idx" ON "disbursements"("groupId");

-- CreateIndex
CREATE INDEX "contributions_externalRef_idx" ON "contributions"("externalRef");

-- CreateIndex
CREATE INDEX "event_contributions_externalRef_idx" ON "event_contributions"("externalRef");

-- CreateIndex
CREATE INDEX "loan_repayments_externalRef_idx" ON "loan_repayments"("externalRef");

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_attendance" ADD CONSTRAINT "meeting_attendance_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_attendance" ADD CONSTRAINT "meeting_attendance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_requestedBy_fkey" FOREIGN KEY ("requestedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
