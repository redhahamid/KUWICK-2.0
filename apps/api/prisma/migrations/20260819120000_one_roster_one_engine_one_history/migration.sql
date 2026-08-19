-- ONE ROSTER, ONE ENGINE, ONE HISTORY.
--
-- The Appointment & Scheduling redesign, phase B. Nothing here deletes a row
-- and nothing here narrows a diary that is already configured: every new
-- column carries a default that reproduces today's behaviour exactly, and the
-- two data migrations at the bottom MAP statuses rather than removing them.
--
-- Five things this makes possible that were impossible before:
--
--   1. AN OVERNIGHT SHIFT. `doctor_schedules` is a weekday plus two TIME
--      columns; 23:00 -> 09:00 gives end < start, and the availability
--      engine's slot loop (`cursor + duration <= window.end`) then runs zero
--      times. A night doctor was silently unbookable — no error, no empty
--      state, just no slots. `provider_shifts` holds two INSTANTS instead, so
--      crossing midnight, a month end or a DST boundary needs no special case.
--
--   2. TWO SHIFTS IN ONE DAY. `schedule_exceptions` is UNIQUE on
--      (tenant, staff, clinic, date) and can hold exactly one window, so
--      08:00-15:00 plus 20:00-23:00 could not be written down.
--
--   3. WHY A PROVIDER IS ABSENT. OFF, LEAVE, BLOCKED and LOCUM are recorded as
--      shifts, so a roster cell can say which it is instead of being blank and
--      meaning four different things.
--
--   4. AN APPOINTMENT'S HISTORY. `appointment_events` is append-only and
--      records status changes, time changes, provider changes, overrides,
--      payments and check-ins — the house pattern (`visit_workflow_events`),
--      not the generic `audit_log` table that has never had a writer.
--
--   5. A PUBLIC BOOKING PAGE. Form fields and their snapshotted answers,
--      communications, reminder rules, per-branch page settings, recurring
--      series and a waitlist.
-- ─────────────────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════════════════
-- 1. ENUMS
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TYPE "AppointmentCancellationReason" AS ENUM (
  'PATIENT_REQUEST', 'CLINIC_REQUEST', 'RESCHEDULED', 'PROVIDER_UNAVAILABLE', 'DUPLICATE', 'OTHER');
CREATE TYPE "AppointmentPaymentStatus" AS ENUM (
  'NOT_REQUIRED', 'PENDING', 'PAID', 'PARTIALLY_PAID', 'FAILED', 'REFUNDED');
CREATE TYPE "ServiceBookingPaymentRule" AS ENUM ('NONE', 'DEPOSIT', 'FULL');
CREATE TYPE "ServicePriceDisplay" AS ENUM ('HIDDEN', 'EXACT', 'FROM');
CREATE TYPE "ProviderScheduleMode" AS ENUM ('ROSTER_LINKED', 'FIXED_WEEKLY');
CREATE TYPE "ProviderShiftType" AS ENUM ('WORKING', 'OFF', 'LEAVE', 'BLOCKED', 'LOCUM');
CREATE TYPE "AppointmentEventType" AS ENUM (
  'CREATED', 'STATUS_CHANGED', 'TIME_CHANGED', 'PROVIDER_CHANGED', 'SERVICE_CHANGED',
  'RESCHEDULED', 'CANCELLED', 'CHECKED_IN', 'OVERRIDE_APPLIED', 'PAYMENT_CHANGED',
  'PATIENT_LINKED', 'COMMUNICATION_SENT', 'NOTE_ADDED');
CREATE TYPE "PatientMatchConfidence" AS ENUM (
  'MATCHED_IDENTIFIER', 'MATCHED_PHONE_AND_NAME', 'CREATED_NEW', 'NEEDS_REVIEW');
CREATE TYPE "BookingFieldType" AS ENUM (
  'SHORT_TEXT', 'LONG_TEXT', 'YES_NO', 'SINGLE_CHOICE', 'MULTI_CHOICE', 'NUMBER', 'DATE');
CREATE TYPE "CommunicationChannel" AS ENUM ('WHATSAPP', 'EMAIL', 'SMS', 'PUSH');
CREATE TYPE "CommunicationStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'SKIPPED', 'MANUAL');
CREATE TYPE "RecurrenceFrequency" AS ENUM ('WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'CUSTOM_DAYS');
CREATE TYPE "WaitlistStatus" AS ENUM ('ACTIVE', 'OFFERED', 'BOOKED', 'EXPIRED', 'CANCELLED');


-- ═════════════════════════════════════════════════════════════════════════════
-- 2. THE ROSTER
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE "provider_shifts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "clinic_id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,

    -- The clinic-local date the shift BELONGS to, which is the date it STARTS.
    -- A 23:00 Wednesday shift ending 09:00 Thursday is Wednesday's shift —
    -- that is how a roster is read aloud and how it is paid.
    "shift_date" DATE NOT NULL,

    -- INSTANTS, not times of day. `ends_at` routinely falls on the next
    -- calendar day and that needs no flag, no special case and no CHECK
    -- exception: it is simply later.
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,

    "shift_type" "ProviderShiftType" NOT NULL DEFAULT 'WORKING',

    -- Appointment availability defaults to the whole shift and may be narrower
    -- than it (§19): a doctor working 09:00-17:00 who takes bookings only
    -- until noon sets these two rather than maintaining a second roster.
    "bookable_starts_at" TIMESTAMP(3),
    "bookable_ends_at" TIMESTAMP(3),

    "note" TEXT,
    "source_schedule_id" TEXT,
    "created_by_staff_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_shifts_pkey" PRIMARY KEY ("id")
);

-- Deliberately NOT unique on (staff, clinic, date). Multiple shifts in one day
-- is the requirement, and a unique key here is precisely the constraint that
-- made `schedule_exceptions` unable to express a split morning/evening list.
CREATE INDEX "provider_shifts_tenant_clinic_date_idx" ON "provider_shifts"("tenant_id", "clinic_id", "shift_date");
CREATE INDEX "provider_shifts_tenant_staff_date_idx" ON "provider_shifts"("tenant_id", "staff_id", "shift_date");
CREATE INDEX "provider_shifts_tenant_clinic_starts_idx" ON "provider_shifts"("tenant_id", "clinic_id", "starts_at");

-- A shift has to have length. Zero-length is not a night off, it is a row the
-- roster screen would draw as a hairline and the engine would offer nothing in.
ALTER TABLE "provider_shifts" ADD CONSTRAINT "provider_shifts_ends_after_it_starts"
  CHECK ("ends_at" > "starts_at");

-- The bookable band is inside the shift, or it is not stated at all. Half-
-- stated is the dangerous case: one column set and the other null would read
-- as "bookable from noon until whenever" and quietly widen the roster.
ALTER TABLE "provider_shifts" ADD CONSTRAINT "provider_shifts_bookable_band_is_inside_the_shift"
  CHECK (
    ("bookable_starts_at" IS NULL AND "bookable_ends_at" IS NULL)
    OR (
      "bookable_starts_at" IS NOT NULL AND "bookable_ends_at" IS NOT NULL
      AND "bookable_starts_at" >= "starts_at"
      AND "bookable_ends_at" <= "ends_at"
      AND "bookable_ends_at" > "bookable_starts_at"
    )
  );

ALTER TABLE "provider_shifts" ADD CONSTRAINT "provider_shifts_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "provider_shifts" ADD CONSTRAINT "provider_shifts_clinic_id_fkey"
  FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "provider_shifts" ADD CONSTRAINT "provider_shifts_staff_id_fkey"
  FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "provider_shifts" ADD CONSTRAINT "provider_shifts_created_by_staff_id_fkey"
  FOREIGN KEY ("created_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Which model a provider's bookable time comes from. FIXED_WEEKLY for
-- everybody who exists today, because that is literally what they have — a
-- `doctor_schedules` weekly pattern — and a migration must not change what
-- anybody's diary says on the day it runs.
ALTER TABLE "staff"
  ADD COLUMN "appointment_schedule_mode" "ProviderScheduleMode" NOT NULL DEFAULT 'FIXED_WEEKLY',
  ADD COLUMN "calendar_color" TEXT;


-- ═════════════════════════════════════════════════════════════════════════════
-- 3. THE CLINIC'S RULES
-- ═════════════════════════════════════════════════════════════════════════════

-- A hard 09:00-17:00 pair with NOT NULL and a default is exactly the "fixed
-- 9-5 assumption" that amputates a 24-hour clinic's night roster. Both sides
-- become nullable, meaning "the clinic does not narrow that end". Existing
-- rows keep the values they were configured with — this widens what CAN be
-- expressed without changing what any clinic currently says.
ALTER TABLE "clinic_booking_settings" DROP CONSTRAINT IF EXISTS "clinic_booking_settings_window_is_a_window";
ALTER TABLE "clinic_booking_settings"
  ALTER COLUMN "first_session_time" DROP NOT NULL,
  ALTER COLUMN "first_session_time" DROP DEFAULT,
  ALTER COLUMN "last_session_time" DROP NOT NULL,
  ALTER COLUMN "last_session_time" DROP DEFAULT;
ALTER TABLE "clinic_booking_settings"
  ADD CONSTRAINT "clinic_booking_settings_window_is_a_window"
  CHECK ("first_session_time" IS NULL OR "last_session_time" IS NULL
         OR "last_session_time" > "first_session_time");

ALTER TABLE "clinic_booking_settings"
  ADD COLUMN "max_advance_days" INTEGER,
  -- FALSE so no existing diary is narrowed by this migration. A Malaysian
  -- public holiday is a payroll fact first and plenty of clinics open on one;
  -- a branch that does shut ticks this once instead of re-typing the national
  -- calendar as branch closed dates.
  ADD COLUMN "observe_public_holidays" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "clinic_booking_settings"
  ADD CONSTRAINT "clinic_booking_settings_max_advance_is_positive"
  CHECK ("max_advance_days" IS NULL OR "max_advance_days" > 0);

-- Whether a PATIENT may read why the clinic is shut. "Deepavali" is fine;
-- "audit by the ministry" is not, and a clinic must still be able to close
-- for it.
ALTER TABLE "clinic_closed_dates"
  ADD COLUMN "reason_is_public" BOOLEAN NOT NULL DEFAULT false;


-- ═════════════════════════════════════════════════════════════════════════════
-- 4. THE SERVICE'S RULES
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE "service_catalog"
  -- Time the provider needs either side. Not part of the appointment: a 09:00
  -- slot with a ten-minute lead-in still starts at 09:00, but nothing else may
  -- occupy 08:50-09:00.
  ADD COLUMN "buffer_before_minutes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "buffer_after_minutes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "max_advance_days" INTEGER,
  -- Overrides the clinic's minimum notice for THIS service. NULL = use the
  -- clinic's; zero is a real answer and means walk-up booking is fine.
  ADD COLUMN "minimum_notice_minutes" INTEGER,
  ADD COLUMN "price_display" "ServicePriceDisplay" NOT NULL DEFAULT 'HIDDEN',
  ADD COLUMN "booking_payment_rule" "ServiceBookingPaymentRule" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "deposit_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN "pre_instructions" TEXT,
  ADD COLUMN "post_instructions" TEXT,
  ADD COLUMN "booking_slug" TEXT;

ALTER TABLE "service_catalog"
  ADD CONSTRAINT "service_catalog_buffers_are_not_negative"
  CHECK ("buffer_before_minutes" >= 0 AND "buffer_after_minutes" >= 0);
ALTER TABLE "service_catalog"
  ADD CONSTRAINT "service_catalog_max_advance_is_positive"
  CHECK ("max_advance_days" IS NULL OR "max_advance_days" > 0);
ALTER TABLE "service_catalog"
  ADD CONSTRAINT "service_catalog_service_notice_is_not_negative"
  CHECK ("minimum_notice_minutes" IS NULL OR "minimum_notice_minutes" >= 0);
ALTER TABLE "service_catalog"
  ADD CONSTRAINT "service_catalog_deposit_is_not_negative"
  CHECK ("deposit_amount" >= 0);

-- The slug is the tail of a public link and must identify one service within
-- the tenant. Partial, so the many services that have no slug do not collide
-- with each other on NULL.
CREATE UNIQUE INDEX "service_catalog_tenant_booking_slug_key"
  ON "service_catalog"("tenant_id", "booking_slug") WHERE "booking_slug" IS NOT NULL;

CREATE TABLE "service_bookable_hours" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "day_of_week" INTEGER NOT NULL,
    "start_time" TIME NOT NULL,
    "end_time" TIME NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "service_bookable_hours_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "service_bookable_hours_tenant_service_day_idx"
  ON "service_bookable_hours"("tenant_id", "service_id", "day_of_week");
ALTER TABLE "service_bookable_hours" ADD CONSTRAINT "service_bookable_hours_day_is_a_day"
  CHECK ("day_of_week" BETWEEN 0 AND 6);
ALTER TABLE "service_bookable_hours" ADD CONSTRAINT "service_bookable_hours_window_is_a_window"
  CHECK ("end_time" > "start_time");
ALTER TABLE "service_bookable_hours" ADD CONSTRAINT "service_bookable_hours_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_bookable_hours" ADD CONSTRAINT "service_bookable_hours_service_id_fkey"
  FOREIGN KEY ("service_id") REFERENCES "service_catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ═════════════════════════════════════════════════════════════════════════════
-- 5. THE APPOINTMENT ITSELF
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE "appointments"
  -- `notes` has always been the INTERNAL note. This is the half that is safe
  -- to publish: what the patient wrote, and what the manage-booking page shows
  -- back to them.
  ADD COLUMN "patient_note" TEXT,
  ADD COLUMN "cancellation_reason" "AppointmentCancellationReason",
  ADD COLUMN "checked_in_at" TIMESTAMP(3),

  -- The same request retried must not become two appointments. A double click,
  -- a network retry and a payment-callback retry all carry the same key; the
  -- partial unique index below is what makes the second one a no-op.
  ADD COLUMN "idempotency_key" TEXT,

  -- An override is a rule set aside, by somebody, for a reason. All three or
  -- none — the service refuses an override that cannot name what it bypassed.
  ADD COLUMN "overridden_rule" TEXT,
  ADD COLUMN "override_reason" TEXT,
  ADD COLUMN "overridden_by_staff_id" TEXT,

  ADD COLUMN "payment_status" "AppointmentPaymentStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN "deposit_invoice_id" TEXT,

  -- The secret in the manage-booking URL. It identifies ONE appointment and
  -- reaches no other patient's data.
  ADD COLUMN "manage_token" TEXT,

  ADD COLUMN "patient_match" "PatientMatchConfidence",
  ADD COLUMN "source_detail" TEXT,
  ADD COLUMN "series_id" TEXT,
  ADD COLUMN "series_index" INTEGER;

CREATE UNIQUE INDEX "appointments_manage_token_key" ON "appointments"("manage_token");
-- Partial: the overwhelming majority of appointments carry no key, and they
-- must not all collide with one another on NULL.
CREATE UNIQUE INDEX "appointments_tenant_idempotency_key"
  ON "appointments"("tenant_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL;
CREATE INDEX "appointments_tenant_series_idx" ON "appointments"("tenant_id", "series_id");

ALTER TABLE "appointments" ADD CONSTRAINT "appointments_overridden_by_staff_id_fkey"
  FOREIGN KEY ("overridden_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_deposit_invoice_id_fkey"
  FOREIGN KEY ("deposit_invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- An override that cannot say what it set aside is not an override, it is an
-- unexplained booking. Enforced here rather than only in the service, because
-- the whole value of the field is that it is answerable later.
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_override_is_answerable"
  CHECK (
    ("overridden_rule" IS NULL AND "override_reason" IS NULL AND "overridden_by_staff_id" IS NULL)
    OR ("overridden_rule" IS NOT NULL AND "override_reason" IS NOT NULL AND "overridden_by_staff_id" IS NOT NULL)
  );


-- ═════════════════════════════════════════════════════════════════════════════
-- 6. THE HISTORY — append-only, and enforced rather than claimed
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE "appointment_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "appointment_id" TEXT NOT NULL,
    "event_type" "AppointmentEventType" NOT NULL,
    "from_status" "AppointmentStatus",
    "to_status" "AppointmentStatus",
    -- BEFORE and AFTER for anything that is not a status: the old provider,
    -- the old time, the old service. JSONB so one table carries all of them
    -- rather than a column per field, none of which would ever be filled in.
    "before_value" JSONB,
    "after_value" JSONB,
    "reason" TEXT,
    "source" "AppointmentSource",
    "actor_staff_id" TEXT,
    -- The actor's name AS IT WAS. A staff member who leaves must not erase
    -- their name from the record of what they did.
    "actor_label" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "appointment_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "appointment_events_tenant_appointment_idx"
  ON "appointment_events"("tenant_id", "appointment_id", "occurred_at");
CREATE INDEX "appointment_events_tenant_occurred_idx"
  ON "appointment_events"("tenant_id", "occurred_at");
ALTER TABLE "appointment_events" ADD CONSTRAINT "appointment_events_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointment_events" ADD CONSTRAINT "appointment_events_appointment_id_fkey"
  FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "appointment_events" ADD CONSTRAINT "appointment_events_actor_staff_id_fkey"
  FOREIGN KEY ("actor_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ═════════════════════════════════════════════════════════════════════════════
-- 7. THE PUBLIC BOOKING SURFACE
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE "booking_form_fields" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "clinic_id" TEXT,
    "service_id" TEXT,
    "label" TEXT NOT NULL,
    "help_text" TEXT,
    "field_type" "BookingFieldType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "options" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "booking_form_fields_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "booking_form_fields_tenant_clinic_idx" ON "booking_form_fields"("tenant_id", "clinic_id");
CREATE INDEX "booking_form_fields_tenant_service_idx" ON "booking_form_fields"("tenant_id", "service_id");
ALTER TABLE "booking_form_fields" ADD CONSTRAINT "booking_form_fields_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "booking_form_fields" ADD CONSTRAINT "booking_form_fields_clinic_id_fkey"
  FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "booking_form_fields" ADD CONSTRAINT "booking_form_fields_service_id_fkey"
  FOREIGN KEY ("service_id") REFERENCES "service_catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The ANSWERS, snapshotted with the question as it was asked. The label and
-- the type are COPIED rather than joined: a clinic that rewords a question
-- next March must not change what a booking made in February appears to have
-- been asked. Same rule as the prescription snapshot and the invoice line.
CREATE TABLE "appointment_form_answers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "appointment_id" TEXT NOT NULL,
    "field_id" TEXT,
    "label" TEXT NOT NULL,
    "field_type" "BookingFieldType" NOT NULL,
    "answer" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "appointment_form_answers_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "appointment_form_answers_tenant_appointment_idx"
  ON "appointment_form_answers"("tenant_id", "appointment_id");
ALTER TABLE "appointment_form_answers" ADD CONSTRAINT "appointment_form_answers_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointment_form_answers" ADD CONSTRAINT "appointment_form_answers_appointment_id_fkey"
  FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "appointment_communications" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "appointment_id" TEXT NOT NULL,
    "channel" "CommunicationChannel" NOT NULL,
    "template" TEXT NOT NULL,
    "destination" TEXT,
    -- MANUAL is a first-class status, not a lesser one: a receptionist pressing
    -- "WhatsApp patient" opens wa.me and sends the message with their own
    -- hands. That IS the delivery. Recording it as SENT would claim a gateway
    -- integration this system does not have.
    "status" "CommunicationStatus" NOT NULL DEFAULT 'QUEUED',
    "provider_message_id" TEXT,
    "error" TEXT,
    "queued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "actor_staff_id" TEXT,
    CONSTRAINT "appointment_communications_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "appointment_communications_tenant_appointment_idx"
  ON "appointment_communications"("tenant_id", "appointment_id");
CREATE INDEX "appointment_communications_tenant_status_idx"
  ON "appointment_communications"("tenant_id", "status", "queued_at");
ALTER TABLE "appointment_communications" ADD CONSTRAINT "appointment_communications_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointment_communications" ADD CONSTRAINT "appointment_communications_appointment_id_fkey"
  FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "appointment_communications" ADD CONSTRAINT "appointment_communications_actor_staff_id_fkey"
  FOREIGN KEY ("actor_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Rows, not two columns. A clinic wanting three reminders, or none, must not
-- need a migration to say so.
CREATE TABLE "appointment_reminder_rules" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "clinic_id" TEXT NOT NULL,
    "service_id" TEXT,
    "offset_minutes" INTEGER NOT NULL,
    "channel" "CommunicationChannel" NOT NULL DEFAULT 'WHATSAPP',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "appointment_reminder_rules_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "appointment_reminder_rules_tenant_clinic_idx"
  ON "appointment_reminder_rules"("tenant_id", "clinic_id");
ALTER TABLE "appointment_reminder_rules" ADD CONSTRAINT "appointment_reminder_rules_offset_is_positive"
  CHECK ("offset_minutes" > 0);
ALTER TABLE "appointment_reminder_rules" ADD CONSTRAINT "appointment_reminder_rules_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointment_reminder_rules" ADD CONSTRAINT "appointment_reminder_rules_clinic_id_fkey"
  FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointment_reminder_rules" ADD CONSTRAINT "appointment_reminder_rules_service_id_fkey"
  FOREIGN KEY ("service_id") REFERENCES "service_catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "clinic_booking_pages" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "clinic_id" TEXT NOT NULL,
    -- Public and shared outside any tenant, so unique across the platform.
    "slug" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "logo_url" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "intro_text" TEXT,
    "require_phone" BOOLEAN NOT NULL DEFAULT true,
    "require_email" BOOLEAN NOT NULL DEFAULT false,
    "require_nric" BOOLEAN NOT NULL DEFAULT false,
    "show_reason_field" BOOLEAN NOT NULL DEFAULT true,
    -- OFF until a clinic turns it on. A public page that goes live by
    -- migration is a page nobody decided to publish.
    "active" BOOLEAN NOT NULL DEFAULT false,
    "allow_patient_reschedule" BOOLEAN NOT NULL DEFAULT true,
    "allow_patient_cancel" BOOLEAN NOT NULL DEFAULT true,
    "patient_change_cutoff_hours" INTEGER NOT NULL DEFAULT 4,
    "confirmation_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "clinic_booking_pages_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "clinic_booking_pages_clinic_id_key" ON "clinic_booking_pages"("clinic_id");
CREATE UNIQUE INDEX "clinic_booking_pages_slug_key" ON "clinic_booking_pages"("slug");
CREATE INDEX "clinic_booking_pages_tenant_idx" ON "clinic_booking_pages"("tenant_id");
ALTER TABLE "clinic_booking_pages" ADD CONSTRAINT "clinic_booking_pages_cutoff_is_not_negative"
  CHECK ("patient_change_cutoff_hours" >= 0);
ALTER TABLE "clinic_booking_pages" ADD CONSTRAINT "clinic_booking_pages_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "clinic_booking_pages" ADD CONSTRAINT "clinic_booking_pages_clinic_id_fkey"
  FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ═════════════════════════════════════════════════════════════════════════════
-- 8. RECURRING SERIES AND THE WAITLIST
-- ═════════════════════════════════════════════════════════════════════════════

-- The INTENT that produced a run of appointments. Every real session is its own
-- appointment row with its own time, status and history; this records only that
-- they were meant as a course, so "this and all future" has something to mean.
CREATE TABLE "appointment_series" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "clinic_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "frequency" "RecurrenceFrequency" NOT NULL,
    "interval_days" INTEGER,
    "occurrences" INTEGER,
    "end_date" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_staff_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "appointment_series_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "appointment_series_tenant_clinic_idx" ON "appointment_series"("tenant_id", "clinic_id");
CREATE INDEX "appointment_series_tenant_patient_idx" ON "appointment_series"("tenant_id", "patient_id");
ALTER TABLE "appointment_series" ADD CONSTRAINT "appointment_series_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointment_series" ADD CONSTRAINT "appointment_series_clinic_id_fkey"
  FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointment_series" ADD CONSTRAINT "appointment_series_patient_id_fkey"
  FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointment_series" ADD CONSTRAINT "appointment_series_staff_id_fkey"
  FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointment_series" ADD CONSTRAINT "appointment_series_service_id_fkey"
  FOREIGN KEY ("service_id") REFERENCES "service_catalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointment_series" ADD CONSTRAINT "appointment_series_created_by_staff_id_fkey"
  FOREIGN KEY ("created_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "appointments" ADD CONSTRAINT "appointments_series_id_fkey"
  FOREIGN KEY ("series_id") REFERENCES "appointment_series"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A patient who wants this service but has no time yet. Its own table and not
-- an appointment in a WAITLIST status: a waitlist entry has no time, spans a
-- RANGE of acceptable dates and may name a daypart rather than an hour.
-- Forcing that into a row whose defining facts are scheduled_start and
-- scheduled_end would mean inventing times nobody agreed to.
CREATE TABLE "waitlist_entries" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "clinic_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "preferred_staff_id" TEXT,
    "earliest_date" DATE,
    "latest_date" DATE,
    "preferred_daypart" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "status" "WaitlistStatus" NOT NULL DEFAULT 'ACTIVE',
    "offered_at" TIMESTAMP(3),
    "booked_appointment_id" TEXT,
    "created_by_staff_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "waitlist_entries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "waitlist_entries_booked_appointment_id_key"
  ON "waitlist_entries"("booked_appointment_id");
CREATE INDEX "waitlist_entries_tenant_clinic_status_idx"
  ON "waitlist_entries"("tenant_id", "clinic_id", "status");
CREATE INDEX "waitlist_entries_tenant_service_status_idx"
  ON "waitlist_entries"("tenant_id", "service_id", "status");
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_date_range_is_a_range"
  CHECK ("earliest_date" IS NULL OR "latest_date" IS NULL OR "latest_date" >= "earliest_date");
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_clinic_id_fkey"
  FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_patient_id_fkey"
  FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_service_id_fkey"
  FOREIGN KEY ("service_id") REFERENCES "service_catalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_preferred_staff_id_fkey"
  FOREIGN KEY ("preferred_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_created_by_staff_id_fkey"
  FOREIGN KEY ("created_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_booked_appointment_id_fkey"
  FOREIGN KEY ("booked_appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ═════════════════════════════════════════════════════════════════════════════
-- 9. ROW-LEVEL SECURITY on everything new
-- ═════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'provider_shifts', 'appointment_events', 'service_bookable_hours',
    'booking_form_fields', 'appointment_form_answers', 'appointment_communications',
    'appointment_reminder_rules', 'clinic_booking_pages', 'appointment_series',
    'waitlist_entries'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true))', t);
  END LOOP;
END $$;


-- ═════════════════════════════════════════════════════════════════════════════
-- 10. APPEND-ONLY, ENFORCED
--
-- `appointment_events` is the record of what was done to a diary that patients
-- and doctors both rely on. Same three layers as patient_alerts and
-- label_prints: a non-superuser application role, RLS, and BEFORE DELETE /
-- BEFORE TRUNCATE triggers that fire for every role including a superuser.
-- ═════════════════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS appointment_events_no_delete ON "appointment_events";
DROP TRIGGER IF EXISTS appointment_events_no_truncate ON "appointment_events";
CREATE TRIGGER appointment_events_no_delete BEFORE DELETE ON "appointment_events"
  FOR EACH STATEMENT EXECUTE FUNCTION kuwick_refuse_append_only_delete();
CREATE TRIGGER appointment_events_no_truncate BEFORE TRUNCATE ON "appointment_events"
  FOR EACH STATEMENT EXECUTE FUNCTION kuwick_refuse_append_only_delete();

COMMENT ON TABLE "appointment_events" IS
  'Append-only. Every status change, reschedule, override, check-in and payment change on an appointment, with the actor and the reason. Enforced by RLS, a non-superuser application role, and BEFORE DELETE/TRUNCATE triggers.';

-- The CASCADE on appointment_events.appointment_id would be refused by the
-- trigger above, which is correct and deliberate: an appointment is never hard
-- deleted in normal operation (§54), so the cascade exists only for a
-- deliberate administrative removal, and that removal now has to be a decision
-- somebody takes with the trigger dropped rather than a side effect.


-- ═════════════════════════════════════════════════════════════════════════════
-- 11. DATA MIGRATION — map the deprecated statuses, destroy nothing
-- ═════════════════════════════════════════════════════════════════════════════

-- A rescheduled appointment is CANCELLED with a reason that says so, plus the
-- link to its replacement that already exists (`rescheduled_from_id` on the new
-- row). RESCHEDULED as a terminal state lost the fact that the patient did not
-- cancel — they moved — and made "how many cancellations this month" wrong in
-- both directions.
--
-- `cancelled_at` is set to the row's own updated_at rather than now(): the
-- reschedule happened when it happened, and stamping today's date onto it
-- would invent a fact.
UPDATE "appointments"
   SET "status" = 'CANCELLED',
       "cancellation_reason" = 'RESCHEDULED',
       "cancelled_at" = COALESCE("cancelled_at", "updated_at")
 WHERE "status" = 'RESCHEDULED';

-- REMINDED was a status that could not coexist with CONFIRMED, so an
-- appointment that was both — which is every reminded appointment — could only
-- show one. The reminder is a FACT, and `reminder_sent_at` already holds it.
UPDATE "appointments" SET "status" = 'CONFIRMED' WHERE "status" = 'REMINDED';

-- IN_QUEUE is CHECKED_IN by a better name, and CHECKED_IN carries the link to
-- the ticket. Anything already ARRIVED with a visit attached is checked in too:
-- the visit and the queue ticket exist, which is precisely what CHECKED_IN
-- asserts.
UPDATE "appointments" SET "status" = 'CHECKED_IN' WHERE "status" = 'IN_QUEUE';
UPDATE "appointments"
   SET "status" = 'CHECKED_IN',
       "checked_in_at" = COALESCE("checked_in_at", "arrived_at")
 WHERE "status" = 'ARRIVED' AND "visit_id" IS NOT NULL;

-- A cancellation that predates this column had a free-text reason or nothing.
-- Classify only what is unambiguous — an existing cancellation with no reason
-- recorded gets OTHER, not a guess at the patient's motive.
UPDATE "appointments"
   SET "cancellation_reason" = 'OTHER'
 WHERE "status" = 'CANCELLED' AND "cancellation_reason" IS NULL;


-- ═════════════════════════════════════════════════════════════════════════════
-- 12. THE OVERLAP CONSTRAINT LEARNS THE NEW STATUSES
--
-- `appointments_no_overlap` excludes CANCELLED, RESCHEDULED and NO_SHOW —
-- states in which an appointment no longer occupies its slot. WAITLIST is
-- exactly such a state and is NEW, so without this the first waitlist entry
-- would collide with the real appointment at the same nominal time.
--
-- RESCHEDULED stays in the list. Nothing writes it any more, but a constraint
-- that stops recognising a value present in historical rows would refuse
-- perfectly good new bookings beside them.
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE "appointments" DROP CONSTRAINT "appointments_no_overlap";
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_no_overlap"
  EXCLUDE USING gist (
    staff_id WITH =,
    tsrange(scheduled_start, scheduled_end) WITH &&
  ) WHERE (status NOT IN ('CANCELLED', 'RESCHEDULED', 'NO_SHOW', 'WAITLIST'));
