-- Consolidates Appointment's temporary Service stand-in (built in 1b) into
-- Clinical Operations' real ServiceCatalog (docs/DECISIONS.md, Clinical 1a
-- Phase 1). Renaming the table preserves every existing row and every
-- foreign key on it (Postgres FKs track by OID, not name) — only the name
-- and one new column change.

ALTER TABLE "appointment_services" RENAME TO "service_catalog";
ALTER TABLE "service_catalog" RENAME CONSTRAINT "appointment_services_pkey" TO "service_catalog_pkey";
ALTER INDEX "appointment_services_tenant_id_idx" RENAME TO "service_catalog_tenant_id_idx";

ALTER TABLE "service_catalog" ADD COLUMN "price" DECIMAL(10,2) NOT NULL DEFAULT 0;
