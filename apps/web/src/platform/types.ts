export interface PlatformTenant {
  id: string;
  name: string;
  slug: string | null;
  status: string;
  registrationNo: string | null;
  createdAt: string;
  clinics?: { id: string; name: string; address: string | null; phone: string | null; email: string | null }[];
  // D-049 — the tenant's OWNER_ADMIN login, editable from the console; null
  // for tenants created before owner-at-creation existed (edit creates it).
  owner?: { staffId: string; fullName: string; email: string } | null;
  subscriptions?: TenantSubscription[];
  _count?: { staff: number; patients: number };
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  description: string | null;
  priceMyr: string;
  durationDays: number;
  maxUsers: number | null;
  maxPatients: number | null;
  maxStorageMb: number | null;
  active: boolean;
}

export type TenantSubscriptionStatus = 'TRIAL' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED';

export interface TenantSubscription {
  id: string;
  tenantId: string;
  planId: string | null;
  status: TenantSubscriptionStatus;
  startsAt: string;
  endsAt: string;
  cancelledAt: string | null;
  tenant?: PlatformTenant;
  plan?: SubscriptionPlan | null;
}

export interface DefaultPanelClinic {
  id: string;
  name: string;
  url: string | null;
  active: boolean;
}

export interface DefaultProcedure {
  id: string;
  code: string | null;
  name: string;
  price: string;
  active: boolean;
}

export interface DefaultDocumentTemplate {
  id: string;
  name: string;
  content: string;
  active: boolean;
}

export interface PlatformDashboardSummary {
  totalActiveClinics: number;
  activeSubscriptionCount: number;
  monthlyRevenueEstimate: number;
  recentSignups: { id: string; name: string; createdAt: string }[];
  expiringSoon: { id: string; tenantName: string; planName: string; endsAt: string }[];
  planDistribution: { name: string; count: number }[];
}

export interface LoginAsResponse {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string };
  staff: { id: string; fullName: string; role: string };
  tenant: { id: string; name: string; slug: string | null };
}
