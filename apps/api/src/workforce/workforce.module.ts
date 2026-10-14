import { Module } from '@nestjs/common';
import { CoreModule } from '../core/core.module';
import { WorkforceController } from './workforce.controller';
import { EmployeeService } from './employee.service';
import { JobTitleService } from './job-title.service';
import { EmployeeIntakeService } from './employee-intake.service';
import { AttendanceRecordService } from './attendance-record.service';
import { AttendancePolicyService } from './attendance-policy.service';
import { ShiftTemplateService } from './shift-template.service';
import { LeaveService } from './leave.service';
import { IncentiveService } from './incentive.service';
import { PayrollService } from './payroll.service';
import { BenefitService } from './benefit.service';
import { LegalEmployerService } from './legal-employer.service';
import { EmployeeSalaryService } from './employee-salary.service';
import { EmployeeRecurringItemService } from './employee-recurring-item.service';
import { StaffFileService } from './staff-file.service';
import { ClaimPolicyService } from './claim-policy.service';
import { ContributionBasisService } from './contribution-basis.service';
import { StatutoryClassificationService } from './statutory-classification.service';
import { PayComponentService } from './pay-component.service';
import { StatutorySettingsService } from './statutory-settings.service';
import { PayrollPolicyService } from './payroll-policy.service';
import { PayrollInputService } from './payroll-input.service';
import { PayrollItemsImportService } from './payroll-items-import.service';
import { StaffClaimService } from './staff-claim.service';
import { LocumService } from './locum.service';
import { PayrollJourneyService } from './payroll-journey.service';
import { PayrollReadinessService } from './payroll-readiness.service';
import { PayrollPayslipService } from './payroll-payslip.service';
import { PayrollPaymentService } from './payroll-payment.service';
import { PayrollStatutoryOutputService } from './payroll-statutory-output.service';
import { PayrollFilingService } from './payroll-filing.service';
import { PayrollTaxService } from './payroll-tax.service';
import { PayrollReportService } from './payroll-report.service';
import { PayrollFinanceService } from './payroll-finance.service';

/**
 * WAVE 4 of the admin programme.
 *
 * Owns employment, attendance, leave entitlement, incentives and payroll. It
 * does NOT own:
 *   - the STAFF row itself, which stays with `HrModule` (identity, roles,
 *     professional credential)
 *   - the ROSTER, which stays with `AppointmentModule` (D-090: one roster, one
 *     engine, one history). Attendance READS shifts and never writes them.
 *   - LEAVE REQUESTS, which stay with `HrModule` — this module supplies the
 *     entitlement they are measured against.
 */
@Module({
  imports: [CoreModule],
  controllers: [WorkforceController],
  providers: [
    EmployeeService,
    JobTitleService,
    EmployeeIntakeService,
    AttendanceRecordService,
    AttendancePolicyService,
    ShiftTemplateService,
    LeaveService,
    IncentiveService,
    PayrollService,
    BenefitService,
    LegalEmployerService,
    EmployeeSalaryService,
    EmployeeRecurringItemService,
    StaffFileService,
    ClaimPolicyService,
    ContributionBasisService,
    StatutoryClassificationService,
    PayComponentService,
    StatutorySettingsService,
    PayrollPolicyService,
    PayrollInputService,
    PayrollItemsImportService,
    StaffClaimService,
    LocumService,
    PayrollJourneyService,
    PayrollReadinessService,
    PayrollPayslipService,
    PayrollPaymentService,
    PayrollStatutoryOutputService,
    PayrollFilingService,
    PayrollTaxService,
    PayrollReportService,
    PayrollFinanceService,
  ],
  exports: [
    EmployeeService,
    AttendanceRecordService,
    AttendancePolicyService,
    ShiftTemplateService,
    LeaveService,
    IncentiveService,
    PayrollService,
    BenefitService,
    LegalEmployerService,
    EmployeeSalaryService,
    EmployeeRecurringItemService,
    StaffFileService,
    ClaimPolicyService,
    ContributionBasisService,
    StatutoryClassificationService,
    PayComponentService,
    StatutorySettingsService,
    PayrollPolicyService,
    PayrollInputService,
    StaffClaimService,
    LocumService,
    PayrollJourneyService,
    PayrollReadinessService,
    PayrollPayslipService,
    PayrollPaymentService,
    PayrollStatutoryOutputService,
    PayrollFilingService,
    PayrollTaxService,
    PayrollReportService,
    PayrollFinanceService,
  ],
})
export class WorkforceModule {}
