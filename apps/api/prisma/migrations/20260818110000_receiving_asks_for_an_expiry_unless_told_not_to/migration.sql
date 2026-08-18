-- RECEIVING ASKS FOR AN EXPIRY UNLESS SOMEBODY SAYS NOT TO.
--
-- Stock Control on the Edit Inventory screen. The default is TRUE and that is
-- the safe direction: a medicine whose expiry nobody was asked for is a
-- medicine that expires on the shelf while the near-expiry screen stays quiet
-- about it. Turning it OFF is a statement about a thing that has no expiry —
-- an arm sling, a tumbler, the four "Item" rows the pricing audit already
-- identified as not medicines.
--
-- Backfilled TRUE for every existing row rather than guessed per category: a
-- clinic switching it off item by item is a small chore, and a migration that
-- decided which of 242 rows do not expire would be inventing clinical facts.

ALTER TABLE "items"
  ADD COLUMN "tracks_batch_expiry" BOOLEAN NOT NULL DEFAULT true;
