-- Real auth (D-034) — Tenant.slug is the tenant-login identifier (User.email
-- is only unique per-tenant, so email alone can't resolve which tenant to
-- log into). PlatformAdmin is deliberately outside RLS/tenant scoping — the
-- one legitimate cross-tenant path this system needs, for the platform
-- operator managing clinic tenants themselves.

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN "slug" TEXT;
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateTable
CREATE TABLE "platform_admins" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_admins_email_key" ON "platform_admins"("email");

-- No RLS on platform_admins — deliberately not tenant-scoped data (D-034).
