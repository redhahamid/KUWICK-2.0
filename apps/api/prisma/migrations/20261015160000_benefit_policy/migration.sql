-- Section F (14 October 2026): the clinic's medical benefit rules.
-- CreateTable
CREATE TABLE "benefit_policies" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "yearly_limit" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "joining_month_cutoff_day" SMALLINT,
    "alert_below_percent" SMALLINT NOT NULL DEFAULT 20,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "benefit_policies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "benefit_policies_tenant_id_key" ON "benefit_policies"("tenant_id");

-- AddForeignKey
ALTER TABLE "benefit_policies" ADD CONSTRAINT "benefit_policies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "benefit_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "benefit_policies" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "benefit_policies"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kuwick_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "benefit_policies" TO kuwick_app;
  END IF;
END $$;
