

-- Add ONGOING to MeetingStatus (used in meeting.controller.js)
ALTER TYPE "MeetingStatus" ADD VALUE IF NOT EXISTS 'ONGOING';

-- Add LATE to AttendanceStatus (used in meeting.controller.js)
ALTER TYPE "AttendanceStatus" ADD VALUE IF NOT EXISTS 'LATE';

-- Add MEETING_SCHEDULED to NotificationType (used in meeting.controller.js)
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'MEETING_SCHEDULED';
