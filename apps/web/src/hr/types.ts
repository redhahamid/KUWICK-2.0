import { Role } from '@kuwick/shared';

export interface Staff {
  id: string;
  tenantId: string;
  role: Role;
  fullName: string;
  staffNumber: string | null;
  active: boolean;
}

export interface CreateStaffDto {
  role: Role;
  fullName: string;
  staffNumber?: string;
}
