import { Button } from 'antd';
import { Link } from 'react-router-dom';
import { HrPage, Panel, PanelHead } from '../hr/ui';
import { IconCompany } from '../hr/ui/icons';

/**
 * WHAT THE PANEL MODULE SHOWS A CLINIC THAT HAS NO PANELS (N-2).
 *
 * Before this, the answer was the claim workspace with every table empty: a
 * screen that looks broken rather than one that looks unstarted, and nothing
 * on it pointing at the first step. HR learned this once already with
 * `PayrollStartGate`.
 *
 * IT IS A GATE, NOT A REDIRECT. Somebody who typed `/admin/panel` gets told
 * where they are and offered the way forward; they are not thrown somewhere
 * they did not ask for, which is how a person loses track of what they
 * clicked. The rest of the module stays reachable — a clinic may genuinely
 * want to look at imported historical claims before setting up a single panel.
 */
export function PanelStartGate() {
  return (
    <HrPage
      title="Panel claims"
      sub="Nothing to show yet, because no panels have been set up."
      helpTo={null}
    >
      <Panel>
        <div style={{ padding: '22px 24px' }}>
          <PanelHead
            icon={<IconCompany />}
            tone="teal"
            title="Start by telling Kuwick who you claim from"
            sub="A panel is anybody who pays part of a patient's bill — an administrator, an insurer, a company you bill direct, or a government body. Once they are set up, every panel visit raises its own claim and this screen fills itself."
          />
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Link to="/admin/panel/setup">
              <Button type="primary">Set up your panels</Button>
            </Link>
            <Link to="/admin/panel/import">
              <Button>I have old claims to bring in</Button>
            </Link>
          </div>
          <div className="kw-muted" style={{ fontSize: 12.5, marginTop: 14, maxWidth: 620 }}>
            It takes four short questions and you can skip any of them. Nothing is filled in on
            your behalf — a payment term you have not given stays blank, and no claim is ever
            called late against a term nobody agreed.
          </div>
        </div>
      </Panel>
    </HrPage>
  );
}
