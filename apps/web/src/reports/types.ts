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
