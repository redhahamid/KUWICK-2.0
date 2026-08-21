-- PHASE 3 — THE DIARY AXIS IS A BRANCH SETTING, NOT A ROSTER READING.
--
-- Live iPad UAT showed the calendar's hour axis wrapping (23:00 → next-day
-- 13:30) because the grid derived its bounds from whoever happened to be
-- rostered. The roster decides AVAILABILITY; these four columns give the
-- calendar its own, stable display source: a branch is either a 24-hour
-- diary (00:00–24:00 always) or a standard-hours one (stated operating
-- hours plus padding).
--
-- Hand-authored and ADDITIVE ONLY: existing rows gain defaults
-- (STANDARD_HOURS, no stated hours, 60 minutes padding) and no existing
-- column, row or policy is touched. clinic_booking_settings already carries
-- this tenant's RLS policy; new columns inherit it.

CREATE TYPE "CalendarDisplayMode" AS ENUM ('STANDARD_HOURS', 'TWENTY_FOUR_HOURS');

ALTER TABLE "clinic_booking_settings"
  ADD COLUMN "calendar_display_mode" "CalendarDisplayMode" NOT NULL DEFAULT 'STANDARD_HOURS',
  ADD COLUMN "display_open_time" TIME,
  ADD COLUMN "display_close_time" TIME,
  ADD COLUMN "display_padding_minutes" INTEGER NOT NULL DEFAULT 60;

-- Stated hours must describe a day: open strictly before close when both are
-- present. (24-hour mode ignores them; the CHECK still keeps stored values
-- honest for the day the branch switches back.)
ALTER TABLE "clinic_booking_settings"
  ADD CONSTRAINT "clinic_booking_settings_display_hours_ordered"
  CHECK (
    "display_open_time" IS NULL
    OR "display_close_time" IS NULL
    OR "display_open_time" < "display_close_time"
  );

ALTER TABLE "clinic_booking_settings"
  ADD CONSTRAINT "clinic_booking_settings_display_padding_sane"
  CHECK ("display_padding_minutes" >= 0 AND "display_padding_minutes" <= 240);
