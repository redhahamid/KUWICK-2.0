export interface ReportDateRangeParams {
  from?: string;
  to?: string;
  clinicId?: string;
}

export interface SalesByDay {
  date: string;
  cash: number;
  panel: number;
}

export interface SalesByPaymentMethod {
  paymentMethod: string;
  amount: number;
}

export interface SalesSummary {
  invoiceCount: number;
  totalRevenue: number;
  cashRevenue: number;
  panelRevenue: number;
  byDay: SalesByDay[];
  byPaymentMethod: SalesByPaymentMethod[];
}

export interface AppointmentAnalytics {
  total: number;
  countByStatus: Record<string, number>;
  noShowRate: number;
  completedRate: number;
  cancelledRate: number;
}

export interface DoctorPerformance {
  staffId: string;
  staffName: string;
  visitCount: number;
  revenue: number;
  revenuePerVisit: number;
}

// ---- Report suite (D-039), built to the owner's Power BI file ----

export interface DayEndSummary {
  date: string;
  invoiceCount: number;
  totalSales: number;
  cashCollected: number;
  panelBilled: number;
  cashPatients: number;
  panelPatients: number;
  unpaidCount: number;
  byPaymentMethod: { paymentMethod: string; amount: number; count: number }[];
  byPanel: { panelName: string; amount: number; patients: number }[];
}

export interface SalesAnalysis {
  totalSales: number;
  panelSales: number;
  nonPanelSales: number;
  averageChargePerPatient: number;
  averageChargePerPanelPatient: number;
  averageChargePerNonPanelPatient: number;
  byCategory: { category: string; amount: number }[];
  byDoctor: { doctorName: string; amount: number }[];
  byPanel: { panelName: string; amount: number }[];
  byDay: { date: string; sales: number; patients: number }[];
}

export interface PatientAnalysis {
  totalVisits: number;
  uniquePatients: number;
  newPatients: number;
  existingPatients: number;
  panelVisits: number;
  cashVisits: number;
  byGender: { gender: string; count: number }[];
  byAgeGroup: { ageGroup: string; count: number }[];
  byPanel: { panelName: string; count: number }[];
  byHour: { hour: number; count: number }[];
  byDayOfWeek: { day: string; count: number }[];
}

export interface ProcedureAnalysis {
  totalRevenue: number;
  lineCount: number;
  byDescription: { description: string; revenue: number; count: number }[];
  byGroup: { group: string; revenue: number; count: number }[];
  byDoctor: { doctorName: string; revenue: number }[];
}

export interface DoctorPerformanceDetailed {
  staffId: string;
  staffName: string;
  patients: number;
  sales: number;
  consultationRevenue: number;
  drugsRevenue: number;
  servicesRevenue: number;
  othersRevenue: number;
  averageChargePerPatient: number;
}

// D-042 — drug fast/slow movers + wait times.
export interface DrugMovementRow {
  itemId: string;
  name: string;
  category: string | null;
  quantity: number;
  revenue: number;
  prescriptions: number;
  movement: 'FAST' | 'MEDIUM' | 'SLOW';
}

export interface WaitTimesSummary {
  visitCount: number;
  measuredWaits: number;
  averageWaitMinutes: number | null;
  averageServiceMinutes: number | null;
  averageTotalVisitMinutes: number | null;
  waitBuckets: { bucket: string; count: number }[];
  byDay: { date: string; averageWaitMinutes: number }[];
}

export interface InvoiceListingRow {
  id: string;
  invoiceNumber: string;
  status: string;
  patientName: string;
  doctorName: string;
  billingType: string;
  panelName: string | null;
  totalAmount: number;
  patientPaidAmount: number;
  panelCoveredAmount: number;
  paymentMethod: string | null;
  paidAt: string | null;
  createdAt: string;
}
