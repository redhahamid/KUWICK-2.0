-- WHO CAN BE BOOKED, FOR WHAT, AND WHEN THE DOOR IS SHUT.
--
-- The scheduling module already knows a doctor's weekly roster
-- (`doctor_schedules`), the days that override it (`schedule_exceptions`),
-- who may perform what (`doctor_service_qualifications`) and how long a slot
-- runs for one doctor-service pair (`slot_capacity_configs`).
--
-- Three facts it has never been able to hold, and all three are the CLINIC's
-- rather than any one doctor's:
--
--   1. The hours the clinic itself books inside. A doctor rostered 08:00-20:00
--      at a clinic whose last session is 17:00 must not be offered at 19:30.
--   2. The days it is shut. Deepavali is not leave for one doctor.
--   3. How much warning it needs. "Book me in four minutes" is a slot the
--      engine can compute and the front desk cannot honour.
--
-- Plus the per-SERVICE booking facts a patient-facing page needs before it can
-- exist at all: whether a service is bookable, what it costs to book, what it
-- is called in plain words, and whether the booking is confirmed or requested.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "clinic_booking_settings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "clinic_id" TEXT NOT NULL,

    -- The clinic's booking window, as a wall clock in `clinics.timezone`.
    -- A window, not an opening time: the clinic may be staffed from 08:00 and
    -- still refuse to book the first patient before 09:00.
    "first_session_time" TIME NOT NULL DEFAULT '09:00',
    "last_session_time" TIME NOT NULL DEFAULT '17:00',

    -- How far ahead a booking must be made. 0 means walk-up booking is fine,
    -- which is a real answer and the safe default: a clinic that has not
    -- thought about this should not have its diary silently narrowed.
    "minimum_notice_minutes" INTEGER NOT NULL DEFAULT 0,

    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinic_booking_settings_pkey" PRIMARY KEY ("id")
);

-- One row per clinic. A second row would be a second answer to "when do we
-- book", and nothing in the engine could choose between them.
CREATE UNIQUE INDEX "clinic_booking_settings_tenant_clinic_key"
  ON "clinic_booking_settings"("tenant_id", "clinic_id");

-- The window has to be a window. A last session before the first is not a
-- narrow clinic, it is a clinic that can never be booked, and the form that
-- produced it would have looked like it worked.
ALTER TABLE "clinic_booking_settings"
  ADD CONSTRAINT "clinic_booking_settings_window_is_a_window"
  CHECK ("last_session_time" > "first_session_time");

ALTER TABLE "clinic_booking_settings"
  ADD CONSTRAINT "clinic_booking_settings_notice_is_not_negative"
  CHECK ("minimum_notice_minutes" >= 0);

ALTER TABLE "clinic_booking_settings" ADD CONSTRAINT "clinic_booking_settings_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "clinic_booking_settings" ADD CONSTRAINT "clinic_booking_settings_clinic_id_fkey"
  FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- THE DAYS THE CLINIC IS SHUT.
--
-- Deliberately NOT a `schedule_exception` with a null staff id. An exception
-- is one doctor's day off and is read per doctor; a public holiday closes the
-- building, and a patient-facing page has to be able to ask "is the clinic
-- open on the 24th" without first knowing which doctors exist.
--
-- The date is a DATE in the clinic's own zone, not an instant. 24 December is
-- 24 December whatever the server is set to.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "clinic_closed_dates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "clinic_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    -- Shown to patients on the public page ("Deepavali"), so it is worth
    -- having, and nullable because a clinic closing for a reason it would
    -- rather not publish must still be able to close.
    "reason" TEXT,
    "created_by_staff_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinic_closed_dates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "clinic_closed_dates_tenant_clinic_date_key"
  ON "clinic_closed_dates"("tenant_id", "clinic_id", "date");
CREATE INDEX "clinic_closed_dates_tenant_clinic_idx"
  ON "clinic_closed_dates"("tenant_id", "clinic_id");

ALTER TABLE "clinic_closed_dates" ADD CONSTRAINT "clinic_closed_dates_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "clinic_closed_dates" ADD CONSTRAINT "clinic_closed_dates_clinic_id_fkey"
  FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "clinic_closed_dates" ADD CONSTRAINT "clinic_closed_dates_created_by_staff_id_fkey"
  FOREIGN KEY ("created_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT A PATIENT MAY BOOK, AND WHAT THEY SEE WHEN THEY DO.
--
-- `service_catalog` already carries the clinical facts — name, category,
-- duration, price. These are the BOOKING facts, and they are separate because
-- most services in the catalogue are not bookable at all: a chest X-ray is an
-- order a doctor places, not a slot a patient picks.
--
-- `bookable` DEFAULTS TO FALSE, so this migration exposes nothing. A clinic
-- turning the public page on decides service by service what appears on it,
-- rather than discovering its whole order catalogue went live.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "service_catalog"
  ADD COLUMN "bookable" BOOLEAN NOT NULL DEFAULT false,

  -- How finely the day is sliced for this service. NULL means "same as the
  -- duration" — back-to-back slots — which is what a clinic means when it has
  -- not said otherwise. A 30-minute consultation on a 15-minute interval
  -- offers 09:00, 09:15, 09:30 and lets them overlap up to the concurrent
  -- limit; that is a room with two chairs, and it has to be stated, not
  -- assumed.
  ADD COLUMN "slot_interval_minutes" INTEGER,

  -- RM, and ZERO IS A REAL ANSWER: most consultations carry no booking fee.
  -- Not nullable, because "no fee" and "nobody has said" would be the same
  -- column value and the public page has to print one of them.
  ADD COLUMN "booking_fee" DECIMAL(10,2) NOT NULL DEFAULT 0,

  -- What the patient reads on the public page. The clinical `name` is
  -- "CONSULTATION - GENERAL"; this is the sentence under it.
  ADD COLUMN "booking_description" TEXT,
  ADD COLUMN "booking_photo_url" TEXT,

  -- FALSE = the booking is confirmed the moment it is made. TRUE = it lands in
  -- the Requests tab and a human says yes. The default is the stricter-looking
  -- one only by accident of it being false; auto-approve is what a walk-in
  -- clinic wants, and it is what an unset service does.
  ADD COLUMN "requires_approval" BOOLEAN NOT NULL DEFAULT false,

  -- How many of this service can run AT ONCE across the whole clinic — two
  -- treatment rooms, one ultrasound machine. NULL means "not limited by a
  -- room", which is the honest state for a consultation: the constraint there
  -- is the doctor, and the doctor is already the roster.
  ADD COLUMN "concurrent_limit" INTEGER;

ALTER TABLE "service_catalog"
  ADD CONSTRAINT "service_catalog_slot_interval_is_positive"
  CHECK ("slot_interval_minutes" IS NULL OR "slot_interval_minutes" > 0);

ALTER TABLE "service_catalog"
  ADD CONSTRAINT "service_catalog_booking_fee_is_not_negative"
  CHECK ("booking_fee" >= 0);

ALTER TABLE "service_catalog"
  ADD CONSTRAINT "service_catalog_concurrent_limit_is_positive"
  CHECK ("concurrent_limit" IS NULL OR "concurrent_limit" > 0);

-- Row-Level Security (see force_rls_core_foundation for why both are needed).
ALTER TABLE "clinic_booking_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clinic_booking_settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "clinic_booking_settings"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "clinic_closed_dates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clinic_closed_dates" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "clinic_closed_dates"
  USING (tenant_id = current_setting('app.tenant_id', true));
