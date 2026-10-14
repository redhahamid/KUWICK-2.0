-- QR ATTENDANCE (UAT, 14 October 2026): kiosk PIN, location mode, clinic
-- networks, QR rotation and the paid-hours rule. All empty: built-in defaults.
-- CreateEnum
CREATE TYPE "AttendanceLocationMode" AS ENUM ('OFF', 'FLAG', 'REFUSE');

-- CreateEnum
CREATE TYPE "PaidHoursRule" AS ENUM ('ROSTER_CONFIRMED', 'SCANS_CAPPED', 'SCANS');

-- AlterEnum
ALTER TYPE "AttendanceSource" ADD VALUE 'PIN';

-- AlterTable
ALTER TABLE "staff" ADD COLUMN     "attendance_pin_hash" TEXT;

-- AlterTable
ALTER TABLE "attendance_policies" ADD COLUMN     "clinic_networks" TEXT,
ADD COLUMN     "location_mode" "AttendanceLocationMode",
ADD COLUMN     "paid_hours_rule" "PaidHoursRule",
ADD COLUMN     "qr_rotate_seconds" INTEGER;

