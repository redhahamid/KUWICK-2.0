-- "REMINDED" IS A STATUS. IT IS NOT A RECORD OF ANYONE REMINDING ANYBODY.
--
-- `AppointmentStatus.REMINDED` says a reminder happened at some point. It
-- cannot say WHEN, or BY WHOM, and being a status it is mutually exclusive
-- with everything else the appointment might be — an appointment that has
-- been reminded AND has arrived can only hold one of the two.
--
-- The dashboard's reminder column has to answer "has this patient been told,
-- and who told them" for a row that is simultaneously CONFIRMED. So the
-- reminder becomes a fact ON the row rather than a state OF it.
--
-- Nullable and never backfilled: no appointment booked before today has a
-- reminder anybody can name, and writing today's date onto them would invent
-- a phone call that never happened.

ALTER TABLE "appointments"
  ADD COLUMN "reminder_sent_at" TIMESTAMP(3),
  ADD COLUMN "reminder_sent_by_staff_id" TEXT;

ALTER TABLE "appointments" ADD CONSTRAINT "appointments_reminder_sent_by_staff_id_fkey"
  FOREIGN KEY ("reminder_sent_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "appointments_tenant_id_clinic_id_scheduled_start_idx"
  ON "appointments"("tenant_id", "clinic_id", "scheduled_start");

-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT THE BOOKING COMMITTED THE PATIENT TO PAY.
--
-- SNAPSHOT, not a join, and for the reason every other printed figure in this
-- system is a snapshot: a clinic that raises its booking fee in March must not
-- retroactively change what a February booking asked for.
--
-- The SERVICE price is deliberately NOT snapshotted here. It is not a
-- commitment — nobody has agreed to pay it, the consultation may be billed
-- differently, and the dashboard's "potential sales" is an estimate of future
-- revenue rather than a charge. Estimates read live; charges are frozen. The
-- day an appointment starts collecting the service price up front, that
-- becomes a snapshot too.
--
-- Zero, not null, on rows that predate this: a booking made before fees
-- existed committed the patient to nothing, which is what zero says.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "appointments"
  ADD COLUMN "booking_fee_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  -- Null while unpaid, which is every row today: nothing collects a booking
  -- fee yet. The column exists now so the dashboard's payment status tells the
  -- truth ("Unpaid") rather than guessing, and so piece 4 has somewhere to
  -- write when it does collect.
  ADD COLUMN "booking_fee_paid_at" TIMESTAMP(3),
  ADD COLUMN "booking_fee_reference" TEXT;

ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_booking_fee_is_not_negative"
  CHECK ("booking_fee_amount" >= 0);

-- A payment that names no amount is not a payment.
ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_no_payment_without_a_fee"
  CHECK ("booking_fee_paid_at" IS NULL OR "booking_fee_amount" > 0);
