import { IsDefined } from 'class-validator';

export class SetGlobalSettingDto {
  // A field with no validator is stripped by the global whitelist pipe, which
  // left `value` undefined and made every save fail (found 16 October 2026).
  @IsDefined()
  value!: unknown;
}
