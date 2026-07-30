import { IsBoolean } from 'class-validator';

export class BulkActivateCatalogDto {
  @IsBoolean()
  active!: boolean;
}
