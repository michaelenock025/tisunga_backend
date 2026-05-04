-- Migration: Add missing enum values required by need_correction codebase
-- 
-- The need_correction controllers use ONGOING (MeetingStatus), LATE (AttendanceStatus),
-- and MEETING_SCHEDULED (NotificationType) but these values don't exist in the DB
-- (they were not present in the good.zip migrations that created the shared database).
--
-- PostgreSQL does not allow removing enum values, so we add them safely here.

-- Add ONGOING to MeetingStatus (used in meeting.controller.js)
ALTER TYPE "MeetingStatus" ADD VALUE IF NOT EXISTS 'ONGOING';

-- Add LATE to AttendanceStatus (used in meeting.controller.js)
ALTER TYPE "AttendanceStatus" ADD VALUE IF NOT EXISTS 'LATE';

-- Add MEETING_SCHEDULED to NotificationType (used in meeting.controller.js)
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'MEETING_SCHEDULED';
