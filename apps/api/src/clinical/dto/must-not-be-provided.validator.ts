import { ValidationOptions, registerDecorator } from 'class-validator';

// C0 (D-051) — reject identity fields that a client must never set.
//
// Why this exists rather than relying on ValidationPipe's
// `forbidNonWhitelisted`: the GLOBAL pipe (main.ts) runs first with
// `whitelist: true`, which silently STRIPS unknown properties. By the time a
// controller-scoped pipe with forbidNonWhitelisted runs, the offending
// property is already gone, so it can never complain — verified live, where a
// posted authorStaffId returned 201 instead of 400.
//
// Declaring the field on the DTO makes it "known" (so whitelisting keeps it)
// and this validator then fails it explicitly. The client learns immediately
// that it cannot set authorship, instead of silently believing it did.
export function MustNotBeProvided(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'mustNotBeProvided',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return value === undefined;
        },
        defaultMessage() {
          return `${propertyName} is set from the authenticated session and must not be supplied by the client`;
        },
      },
    });
  };
}
