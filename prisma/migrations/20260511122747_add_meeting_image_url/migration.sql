-- AlterTable
ALTER TABLE "meetings" ADD COLUMN     "imageUrl" TEXT,
ADD COLUMN     "images" JSONB;

-- DropEnum
DROP TYPE "JoinRequestStatus";
