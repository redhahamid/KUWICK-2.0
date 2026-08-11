import { Button, Popover, Typography } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';

const { Text } = Typography;

interface AttributionInfoProps {
  /** Server-derived snapshot. Null on rows written before G2a captured it. */
  name: string | null;
  role: string | null;
  /** ISO timestamp. Null only if the row predates the column. */
  at: string | null;
  /** What the attribution belongs to — used in the accessible name. */
  subject: string;
}

/**
 * G4.5 closure (D-072) — attribution that is not mouse-only.
 *
 * G4.5c moved diagnosis attribution into a tooltip on the name to buy back the
 * height that pushed Direct Services off the first screen. That was the right
 * trade for density and the wrong one for access: a tooltip on a plain <Text>
 * has no focusable trigger, so it was unreachable by keyboard, unreliable on
 * touch, and invisible to a screen reader.
 *
 * This is a real button. It opens on hover, on focus and on click, so mouse,
 * keyboard and touch all reach the same content. The full attribution is also
 * written into `aria-label`, which means a screen reader announces who
 * recorded the diagnosis and when WITHOUT having to open anything — the
 * popover is a visual convenience, not the only channel.
 *
 * Attribution stays secondary and stays server-derived. Nothing here sends an
 * actor, a name or a role to the API; it only renders the snapshot the server
 * wrote. The permanent per-row attribution line is deliberately NOT restored.
 */
export function AttributionInfo({ name, role, at, subject }: AttributionInfoProps) {
  const when = at ? dayjs(at) : null;
  // Legacy rows are named as legacy rows. A diagnosis recorded before G2a
  // captured authorship has no author, and inventing "Unknown" would read as
  // a fact about a person rather than a gap in the record.
  const recorded = Boolean(name);

  const spokenWho = recorded
    ? `Added by ${name}${role ? `, ${role.replace(/_/g, ' ').toLowerCase()}` : ''}`
    : 'Added by: not recorded. This entry predates attribution capture.';
  const spokenWhen = when ? `, ${when.format('D MMM YYYY, HH:mm')}` : '';

  const content = (
    <div style={{ maxWidth: 260 }}>
      <div>
        <Text type="secondary" style={{ fontSize: 12 }}>
          Added by{' '}
        </Text>
        {recorded ? (
          <Text strong style={{ fontSize: 13 }}>
            {name}
          </Text>
        ) : (
          <Text italic style={{ fontSize: 13 }}>
            Not recorded
          </Text>
        )}
      </div>

      {recorded && role && (
        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {role.replace(/_/g, ' ')}
          </Text>
        </div>
      )}

      <div>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {when ? when.format('D MMM YYYY, HH:mm') : 'Date not recorded'}
        </Text>
      </div>

      {!recorded && (
        <div style={{ marginTop: 6 }}>
          <Text type="secondary" italic style={{ fontSize: 12 }}>
            This entry predates attribution capture, so no author was stored with it.
          </Text>
        </div>
      )}
    </div>
  );

  return (
    // 'click' is deliberately NOT in this list, and this cost two wrong
    // attempts to work out. `click` TOGGLES, and every pointer interaction
    // that clicks also focuses — so with `focus` in the list, focus opened the
    // popover and the click that caused it closed it again. On a phone that
    // reads as a dead control; with a mouse it flickers.
    //
    // hover + focus has one opening rule per input method and no toggle:
    // mouse hovers, keyboard tabs, and a tap focuses the button. Tapping or
    // clicking elsewhere blurs it shut.
    <Popover content={content} trigger={['hover', 'focus']} placement="topLeft">
      <Button
        type="text"
        size="small"
        className="kw-attribution-btn"
        icon={<InfoCircleOutlined />}
        aria-label={`${subject}. ${spokenWho}${spokenWhen}`}
      />
    </Popover>
  );
}
