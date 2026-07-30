-- Clinical fidelity pass (D-027, docs/DECISIONS.md): the audited
-- kuwick.com Services & Procedures admin screen shows a CATEGORY column
-- (e.g. Laboratory, Imaging, Procedure) alongside code/orderType.

ALTER TABLE "service_catalog" ADD COLUMN "category" TEXT;
