import { Injectable, PipeTransform } from '@nestjs/common';
import { parseDateParam, parseOptionalDateParam, toDateParam } from './query-dates';

/**
 * `@Query('from', RequiredDateParam)` — a date, or an honest 400.
 *
 * The admin reports are all scoped by a date or a range, and every one of them
 * used to take the raw query string straight into
 * `new Date(`${from}T00:00:00.000Z`)`. Omit the parameter and that becomes
 * "undefinedT00:00:00.000Z"; misspell it and it becomes an Invalid Date. Either
 * way the bad value travelled on into Prisma or into `getUTCFullYear()` and
 * came back to the caller as a bare 500 "Internal server error", which tells
 * nobody anything and looks, from the outside, exactly like a broken server.
 *
 * A pipe rather than a DTO because these are query strings on GET endpoints,
 * some of which predate this work and have callers this branch does not own.
 * One decorator argument per parameter, and the service below keeps taking the
 * same string it always took — now guaranteed to parse.
 *
 * The value handed on is normalised to `YYYY-MM-DD`, so a caller passing a
 * full ISO instant cannot make two endpoints disagree about which day it is.
 */
@Injectable()
export class RequiredDateParam implements PipeTransform<string, string> {
  transform(value: string, metadata: { data?: string }): string {
    return toDateParam(parseDateParam(value, metadata?.data ?? 'date'));
  }
}

/** The same, for a filter that is genuinely allowed to be absent. */
@Injectable()
export class OptionalDateParam implements PipeTransform<string | undefined, string | undefined> {
  transform(value: string | undefined, metadata: { data?: string }): string | undefined {
    const parsed = parseOptionalDateParam(value, metadata?.data ?? 'date');
    return parsed === undefined ? undefined : toDateParam(parsed);
  }
}

/**
 * `YYYY-MM` — a payroll period or an incentive run month. Same reasoning; the
 * services slice(0,7) it and append "-01", which produces "undefined-01" for a
 * missing value.
 */
@Injectable()
export class RequiredMonthParam implements PipeTransform<string, string> {
  transform(value: string, metadata: { data?: string }): string {
    const name = metadata?.data ?? 'period';
    const month = typeof value === 'string' ? value.slice(0, 7) : value;
    return toDateParam(parseDateParam(month ? `${month}-01` : undefined, name)).slice(0, 7);
  }
}
