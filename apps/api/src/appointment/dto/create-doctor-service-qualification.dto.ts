import { IsUUID } from 'class-validator';

export class CreateDoctorServiceQualificationDto {
  @IsUUID()
  staffId!: string;

  @IsUUID()
  serviceId!: string;
}
