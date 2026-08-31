import { CLAIM_IMPORT_COLUMNS, claimImportTemplate, parseClaimImportCsv } from './claim-import-csv';

/** Build a one-row file from the template's headers. */
function file(rows: Array<Record<string, string>>): string {
  const headers = CLAIM_IMPORT_COLUMNS.map((column) => column.header);
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => (row[header] ?? '').replace(/,/g, ' ')).join(','));
  }
  return lines.join('\n') + '\n';
}

const OK: Record<string, string> = {
  'Claim No': 'MC-2025-0001',
  'Service Date': '2025-11-04',
  'Patient Reference': 'FILE-20194',
  'Claimed Amount (RM)': '120.00',
  'Fee Amount (RM)': '9.60',
  Status: 'SUBMITTED',
  'Submitted Date': '2025-11-06',
};

describe('the claim import template', () => {
  it('1. parses its own example rows without a single problem', () => {
    // A template that does not import is a template nobody trusts.
    const parsed = parseClaimImportCsv(claimImportTemplate());
    expect(parsed.problems).toEqual([]);
    expect(parsed.rows).toHaveLength(3);
  });

  it('2. shows a blank approved amount on the claim nobody has adjudicated', () => {
    const [awaiting] = parseClaimImportCsv(claimImportTemplate()).rows;
    expect(awaiting.approvedAmount).toBeNull();
  });
});

describe('what the importer refuses', () => {
  it('3. an empty file', () => {
    expect(parseClaimImportCsv(file([])).problems[0].message).toMatch(/no rows/i);
  });

  it('4. the same claim number twice, naming the other line', () => {
    const parsed = parseClaimImportCsv(file([OK, { ...OK, 'Patient Reference': 'FILE-2' }]));
    expect(parsed.problems[0].message).toMatch(/also on line 2/);
  });

  it('5. an ambiguous date, rather than choosing a reading of it', () => {
    const parsed = parseClaimImportCsv(file([{ ...OK, 'Service Date': '4/11/25' }]));
    expect(parsed.problems[0].column).toBe('Service Date');
    expect(parsed.problems[0].message).toMatch(/different days in different countries/);
  });

  it('6. the 31st of February', () => {
    const parsed = parseClaimImportCsv(file([{ ...OK, 'Service Date': '2025-02-31' }]));
    expect(parsed.problems[0].message).toMatch(/not a real date/);
  });

  it('7. a status it would otherwise have to guess at', () => {
    const parsed = parseClaimImportCsv(file([{ ...OK, Status: 'sent to them' }]));
    expect(parsed.problems[0].column).toBe('Status');
  });

  it('8. a PAID claim with no money against it', () => {
    const parsed = parseClaimImportCsv(file([{ ...OK, Status: 'PAID' }]));
    expect(parsed.problems[0].column).toBe('Paid Amount (RM)');
    expect(parsed.problems[0].message).toMatch(/actually banked/);
  });

  it('9. a rejection with no reason', () => {
    const parsed = parseClaimImportCsv(
      file([{ ...OK, Status: 'REJECTED', 'Rejected Amount (RM)': '110.40' }]),
    );
    expect(parsed.problems[0].column).toBe('Rejection Reason');
  });

  it('10. money received against a claim that was never sent', () => {
    const parsed = parseClaimImportCsv(
      file([{ ...OK, 'Submitted Date': '', 'Paid Amount (RM)': '110.40' }]),
    );
    expect(parsed.problems.some((problem) => problem.column === 'Submitted Date')).toBe(true);
  });

  it('11. a panel approving more than it was asked for', () => {
    const parsed = parseClaimImportCsv(file([{ ...OK, 'Approved Amount (RM)': '200.00' }]));
    expect(parsed.problems[0].message).toMatch(/cannot approve more than it was asked for/);
  });

  it('12. an adjudication dated before the submission', () => {
    const parsed = parseClaimImportCsv(
      file([{ ...OK, 'Adjudicated Date': '2025-11-01', 'Approved Amount (RM)': '110.40' }]),
    );
    expect(parsed.problems[0].column).toBe('Adjudicated Date');
  });

  it('13. a negative amount, because a credit is a separate claim', () => {
    const parsed = parseClaimImportCsv(file([{ ...OK, 'Claimed Amount (RM)': '-120.00' }]));
    expect(parsed.problems[0].message).toMatch(/cannot be negative/);
  });

  it('14. a claim nobody can trace back to a patient', () => {
    const parsed = parseClaimImportCsv(file([{ ...OK, 'Patient Reference': '' }]));
    expect(parsed.problems[0].column).toBe('Patient Reference');
  });

  it('15. and reports EVERY problem in the file at once, not the first', () => {
    // One pass through the spreadsheet instead of one round trip per mistake.
    const parsed = parseClaimImportCsv(
      file([
        { ...OK, 'Claim No': '' },
        { ...OK, 'Claim No': 'MC-2', 'Service Date': 'yesterday' },
        { ...OK, 'Claim No': 'MC-3', Status: 'maybe' },
      ]),
    );
    expect(parsed.problems.map((problem) => problem.line).sort()).toEqual([2, 3, 4]);
  });
});

describe('what the importer accepts', () => {
  it('16. RM and thousands separators, because that is what a spreadsheet exports', () => {
    const parsed = parseClaimImportCsv(file([{ ...OK, 'Claimed Amount (RM)': 'RM 1200.50' }]));
    expect(parsed.problems).toEqual([]);
    expect(parsed.rows[0].claimedAmount).toBe(1200.5);
  });

  it('17. a status written with a space or a dash', () => {
    const parsed = parseClaimImportCsv(
      file([{ ...OK, Status: 'partially paid', 'Paid Amount (RM)': '50.00' }]),
    );
    expect(parsed.problems).toEqual([]);
    expect(parsed.rows[0].status).toBe('PARTIALLY_PAID');
  });

  it('18. a blank fee, which is zero — unlike a blank approved amount, which is not', () => {
    const parsed = parseClaimImportCsv(file([{ ...OK, 'Fee Amount (RM)': '' }]));
    expect(parsed.rows[0].feeAmount).toBe(0);
    expect(parsed.rows[0].approvedAmount).toBeNull();
  });
});
