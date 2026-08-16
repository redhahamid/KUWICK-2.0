-- b2 PHASE E — what an order actually needs somebody to know.
--
-- `OrderService` carried the WHAT (`procedure_name`, `code`) and a free-text
-- `instruction`, and nothing else about the work. Three things a clinic needs
-- had nowhere to live, so they were either lost or typed into the instruction
-- as prose nobody can filter on:
--
--   WHERE it happens. A wound dressing goes to a treatment room; a doctor
--   ordering one could name the room only in a sentence, and the Tasks queue
--   could not group by it.
--   HOW URGENTLY. Everything sat in one undifferentiated PENDING pile.
--   HOW MANY. A standard service billed once however many were delivered —
--   three dressings and one dressing produced the same invoice line.
--
-- `quantity` defaults to 1 and is NOT NULL, because every row already written
-- was exactly one of the thing, and that is a fact about them rather than a
-- guess. `room_id` and `urgency` are nullable: an order placed before this
-- migration genuinely had no room and no urgency, and inventing "Routine" for
-- it would be this migration making a claim about work it never saw.

CREATE TYPE "OrderUrgency" AS ENUM ('ROUTINE', 'URGENT');

ALTER TABLE "order_services"
  ADD COLUMN "room_id" TEXT,
  ADD COLUMN "urgency" "OrderUrgency",
  ADD COLUMN "quantity" INTEGER NOT NULL DEFAULT 1;

-- ON DELETE SET NULL, not CASCADE. Retiring a treatment room must never
-- delete the record that a procedure was carried out in it; the order simply
-- stops naming a room that no longer exists.
ALTER TABLE "order_services"
  ADD CONSTRAINT "order_services_room_id_fkey"
  FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The Tasks queue reads outstanding work by room. Without this it filters a
-- growing table on an unindexed column every time a station refreshes.
CREATE INDEX "order_services_tenant_room_status_idx"
  ON "order_services" ("tenant_id", "room_id", "status");

COMMENT ON COLUMN "order_services"."quantity" IS
  'How many were delivered. The invoice multiplies the catalogue price by this; it is NOT NULL because every row written before it existed was exactly one.';

COMMENT ON COLUMN "order_services"."urgency" IS
  'NULL means the order predates urgency being captured — deliberately not backfilled to ROUTINE, which would be a claim about work nobody assessed.';
