import { useState } from "react";

export type WorkingRows = Record<string, string | number | null>;

const TITLES: [key: string, label: string][] = [
  ["epf", "EPF"],
  ["socso", "SOCSO"],
  ["eis", "EIS"],
  ["lindung", "LINDUNG 24 JAM"],
  ["pcb", "PCB (MTD)"],
];

/**
 * HOW EACH STATUTORY FIGURE WAS WORKED OUT — the wages it was read against,
 * the table row or the formula letters, the edition that held the row —
 * frozen with the payslip and shown on request. A figure that could not be
 * worked out has its note on the line instead and no rows here.
 */
export function PayslipWorkings({
  workings,
}: {
  workings: Partial<Record<string, WorkingRows | null>> | undefined;
}) {
  const [open, setOpen] = useState(false);
  const sections = TITLES.filter(
    ([key]) =>
      workings?.[key] && Object.keys(workings[key] as WorkingRows).length > 0,
  );
  if (sections.length === 0) return null;
  return (
    <div className="hr-workings">
      <button
        type="button"
        className="hr-btn hr-btn--ghost hr-btn--sm"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "Hide how this was worked out" : "How this was worked out"}
      </button>
      {open ? (
        <div className="hr-workings__body">
          {sections.map(([key, label]) => (
            <div key={key} className="hr-workings__scheme">
              <h4>{label}</h4>
              <dl className="hr-workings__rows">
                {Object.entries(workings![key] as WorkingRows).map(
                  ([row, value]) => (
                    <div key={row} className="hr-workings__row">
                      <dt>{row}</dt>
                      <dd>
                        {value === null || value === undefined
                          ? "—"
                          : String(value)}
                      </dd>
                    </div>
                  ),
                )}
              </dl>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
