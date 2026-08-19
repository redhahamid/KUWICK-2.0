-- THE DIARY LEARNS NEW WORDS, IN ITS OWN MIGRATION AND FOR A REASON.
--
-- PostgreSQL will let `ALTER TYPE ... ADD VALUE` run inside a transaction, but
-- it will NOT let the new value be USED in that same transaction — the error is
-- "unsafe use of new value of enum type". Prisma wraps each migration file in
-- one transaction, so adding CHECKED_IN and then updating a row to CHECKED_IN
-- in a single file fails on a real database and passes on none.
--
-- Hence this file does exactly one thing: it teaches the two enums their new
-- values. The migration that follows uses them.
--
-- Nothing is removed. REMINDED, RESCHEDULED and IN_QUEUE stay in the type so no
-- historical row becomes unreadable; the next migration stops them being
-- CURRENT, which is a different thing from destroying them.

-- CHECKED_IN and WAITLIST are ADDED; nothing is removed. REMINDED, RESCHEDULED
-- and IN_QUEUE stay in the type so that no historical row becomes unreadable —
-- the data migration below stops them being CURRENT, which is a different
-- thing from destroying them.
ALTER TYPE "AppointmentStatus" ADD VALUE IF NOT EXISTS 'CHECKED_IN';
ALTER TYPE "AppointmentStatus" ADD VALUE IF NOT EXISTS 'WAITLIST';

-- Booking source gains the categories §41 asks for. FRONT_DESK and
-- ONLINE_PORTAL keep their meanings (staff-created, and the public page)
-- rather than being renamed: an enum value is a stored fact in every
-- historical row, and the marketing-shaped detail now lives in
-- `appointments.source_detail` so a new campaign never needs a new value.
ALTER TYPE "AppointmentSource" ADD VALUE IF NOT EXISTS 'PATIENT_APP';
ALTER TYPE "AppointmentSource" ADD VALUE IF NOT EXISTS 'FOLLOW_UP';
ALTER TYPE "AppointmentSource" ADD VALUE IF NOT EXISTS 'QR';
ALTER TYPE "AppointmentSource" ADD VALUE IF NOT EXISTS 'WEBSITE';
ALTER TYPE "AppointmentSource" ADD VALUE IF NOT EXISTS 'WHATSAPP';
ALTER TYPE "AppointmentSource" ADD VALUE IF NOT EXISTS 'CAMPAIGN';
ALTER TYPE "AppointmentSource" ADD VALUE IF NOT EXISTS 'IMPORT';
ALTER TYPE "AppointmentSource" ADD VALUE IF NOT EXISTS 'API';
