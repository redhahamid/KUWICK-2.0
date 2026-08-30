import { AdminNotice, AdminSection, AdminShell } from '../components/AdminShell';

/**
 * e-INVOICE (LHDN) — a door with nothing behind it, saying so.
 *
 * This entry is in the approved navigation and has been since before the admin
 * programme; the submission work has never been built. It is listed here for
 * one reason: an owner looking for it should find out in two seconds that it
 * does not exist yet, rather than hunt for the screen through five modules and
 * conclude they have misremembered where it lives.
 *
 * The alternative — leaving it out of the rail — hides a known gap behind an
 * absence, and an absence looks exactly like a feature somebody has not found.
 */
export function EInvoicePage() {
  return (
    <AdminShell
      title="e-Invoice (LHDN)"
      subtitle="Malaysian e-Invoice submission. Not built — this page exists to say so plainly."
    >
      <AdminNotice tone="warn">
        <strong>NOT IMPLEMENTED.</strong> Kuwick does not submit invoices to the LHDN MyInvois portal, does not
        generate a submission file, and holds no submission status against any invoice. Nothing on this branch changed
        that in either direction.
      </AdminNotice>

      <AdminSection
        title="What does exist today"
        description="The parts an e-Invoice submission would need, and where they already are."
      >
        <ul className="kw-adminList">
          <li>
            <strong>Buyer details on the patient record.</strong> The fields an e-Invoice needs about the buyer are
            captured and editable, gated by the <code>patient.lhdn.write</code> permission.
          </li>
          <li>
            <strong>Line-level tax.</strong> Every invoice line carries its tax code, treatment, rate and amount,
            snapshotted at the rate in force on that invoice’s own date — see Finance ▸ Tax / SST.
          </li>
          <li>
            <strong>An immutable invoice.</strong> Corrections are credit notes against the original document, never
            edits to it, which is the shape a submitted document has to keep.
          </li>
        </ul>
      </AdminSection>

      <AdminSection title="What is missing" description="Named, so the size of the gap is legible.">
        <ul className="kw-adminList">
          <li>MyInvois API credentials, certificate handling and the submission client.</li>
          <li>A submission status and document UUID stored against each invoice.</li>
          <li>Validation against LHDN’s own schema before submission, and handling of a rejection.</li>
          <li>Consolidated monthly submission for invoices below the threshold.</li>
          <li>Cancellation and rejection windows, which have their own statutory time limits.</li>
        </ul>
      </AdminSection>
    </AdminShell>
  );
}
