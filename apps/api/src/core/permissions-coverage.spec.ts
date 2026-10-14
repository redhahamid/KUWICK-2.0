import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * EVERY PERMISSION IS CHECKED SOMEWHERE, OR SAYS WHY NOT.
 *
 * The audit of September 2026 (docs/PERMISSIONS_AUDIT_2026-09.md) found 82
 * keys in the catalogue and 11 that nothing in the API ever checks. A grant
 * nobody checks is a promise the product does not keep, in both directions:
 * a role appears to hold a power it does not need, or an act runs with no
 * gate at all. The eleven are listed here with their reason, and a new key
 * that is neither checked nor listed fails this spec.
 */
const SRC = join(__dirname, '..');

/** Keys the catalogue holds that no check reads, and why each still exists. */
const RESERVED: Record<string, string> = {
  'note.sign': 'Enforced by the signing credential on the staff row, not by the key.',
  'prescription.write': 'Gated by note.write through requireClinicalAuthor; wiring it in changes nothing today.',
  'order.write': 'Gated by note.write; wiring it in changes nothing today.',
  'consultation.complete': 'Gated by note.write plus the attending-doctor rule.',
  'allergy.write': 'Superseded by patient.alert.medical.write; allergies are alert types.',
  'discount.approve': 'Superseded by billing.corrections.',
  'consultation.resume': 'Gated by queue.consultationFlow; wiring it in needs the owner’s agreement.',
  'order.fulfil': 'Nothing gates order start, complete or cancel — a gap for the owner to assign.',
  'procurement.manage': 'Nothing gates procurement requests, purchase orders, goods receiving or suppliers — a gap for the owner to assign.',
  'patient.lhdn.write': 'Patients have no e-Invoice buyer fields yet; reserved.',
  'document.print': 'Printing happens in the browser; reserved.',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.ts') && !full.endsWith('.spec.ts') && !full.endsWith('permissions.ts')) out.push(full);
  }
  return out;
}

describe('the permission catalogue', () => {
  const catalogue = readFileSync(join(SRC, 'core', 'permissions.ts'), 'utf8');
  // The union's members, one per line, up to the member that carries the closing semicolon.
  const keys: string[] = [];
  const lines = catalogue.slice(catalogue.indexOf('export type Permission =')).split('\n');
  for (const line of lines) {
    const member = line.match(/^\s*\|\s*'([^']+)'(;?)\s*$/);
    if (!member) continue;
    keys.push(member[1]);
    if (member[2] === ';') break;
  }
  const sources = walk(SRC).map((file) => readFileSync(file, 'utf8')).join('\n');
  const checked = (key: string) => sources.includes(`'${key}'`) || sources.includes(`"${key}"`);

  // 82 at the audit, + the staff and doctor halves of the roster (UAT, 14 October 2026).
  it('has the 84 keys the audit counted, plus the two roster halves', () => {
    expect(new Set(keys).size).toBe(84);
  });

  it('checks every key somewhere in the API, or lists it with a reason', () => {
    const unexplained = keys.filter((key) => !checked(key) && !(key in RESERVED));
    expect(unexplained).toEqual([]);
  });

  it('does not keep a reason for a key that is checked after all', () => {
    const stale = Object.keys(RESERVED).filter((key) => checked(key));
    expect(stale).toEqual([]);
  });
});
