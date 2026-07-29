-- HR-lite: just enough of a Staff/Doctor entity for the Appointment module
-- (docs/DATABASE_ARCHITECTURE.md §4) to check roster/qualification rules
-- against. Full HR (attendance, leave, incentives) is not built here.

-- CreateTable
CREATE TABLE "staff" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT,
    "role" "Role" NOT NULL,
    "full_name" TEXT NOT NULL,
    "staff_number" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "staff_user_id_key" ON "staff"("user_id");

-- CreateIndex
CREATE INDEX "staff_tenant_id_idx" ON "staff"("tenant_id");

-- CreateIndex
CREATE INDEX "staff_tenant_id_role_idx" ON "staff"("tenant_id", "role");

-- AddForeignKey
ALTER TABLE "staff" ADD CONSTRAINT "staff_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff" ADD CONSTRAINT "staff_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row-Level Security (see the force_rls_core_foundation migration for why
-- both ENABLE and FORCE are required)
ALTER TABLE "staff" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "staff"
  USING (tenant_id = current_setting('app.tenant_id', true));
