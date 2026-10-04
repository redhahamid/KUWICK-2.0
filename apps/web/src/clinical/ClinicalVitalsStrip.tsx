import { Button, Space, Typography } from 'antd';
import { HeartOutlined } from '@ant-design/icons';
import { IconTile } from '../design-system/components/IconTile';
import { formatClinicTime } from './clinicTime';
import { useLatestObservation } from './hooks/useVisitObservations';
import { displayBmi } from './vitalsBmi';

const { Text } = Typography;

/**
 * G4.5a (D-071) — the observations a doctor glances at while writing.
 *
 * Only RECORDED values appear. The old vitals grid rendered a labelled box
 * for every observation the schema supports, so an empty visit showed ten
 * placeholders and a busy one buried the four numbers that mattered — and an
 * empty box beside "SpO₂" reads as "measured, normal" rather than "never
 * taken". Nothing here is derived except BMI, which is computed only when
 * both weight and height exist (D-071 §G).
 *
 * Recording and correcting still happen in `VisitObservationsPanel`, which is
 * untouched: this strip reads, it does not write.
 */
interface ClinicalVitalsStripProps {
  /** D-077 — reveals the full Vitals & Observations panel below the strip. */
  expanded?: boolean;
  onToggleExpand?: () => void;
  visitId: string;
  onRecord?: () => void;
}

// G4.5d3c-3c — the local `bmiFrom` that used to live here is gone. It was a
// second implementation of the clinic's BMI rule, and a second implementation
// of a clinical number is one that can disagree with the first. Every surface
// now reads `displayBmi`: the server's stored value where there is one, the
// shared calculation where there is not.
export function ClinicalVitalsStrip({ visitId, onRecord, expanded, onToggleExpand }: ClinicalVitalsStripProps) {
  const { data: latest, isLoading } = useLatestObservation(visitId);

  if (isLoading) {
    return null;
  }
  if (!latest) {
    return (
      <div className="kw-vitals-strip">
        <IconTile tone="rose" size="sm">
          <HeartOutlined />
        </IconTile>
        <Text type="secondary" style={{ fontSize: 12 }}>
          No vitals recorded yet
        </Text>
        {onToggleExpand && (
          <Button size="small" type="link" className="kw-vitals-action" onClick={onToggleExpand}>
            {expanded ? 'Hide' : 'Record vitals'}
          </Button>
        )}
      </div>
    );
  }

  const bmi = displayBmi({ serverBmi: latest.bmi, weight: latest.weight, height: latest.height });
  const entries: [string, string | null][] = [
    ['BP', latest.bpSystolic && latest.bpDiastolic ? `${latest.bpSystolic}/${latest.bpDiastolic}` : null],
    ['PR', latest.pulse ? `${latest.pulse}` : null],
    ['Temp', latest.temperature ? `${latest.temperature}°C` : null],
    ['SpO₂', latest.spo2 ? `${latest.spo2}%` : null],
    ['RR', latest.respRate ? `${latest.respRate}` : null],
    ['Weight', latest.weight ? `${latest.weight}kg` : null],
    ['Height', latest.height ? `${latest.height}cm` : null],
    ['BMI', bmi],
    ['Glucose', latest.glucose ? `${latest.glucose}` : null],
    ['Pain', latest.painScore != null ? `${latest.painScore}/10` : null],
  ];
  const recorded = entries.filter(([, value]) => value !== null);

  return (
    <div className="kw-vitals-strip">
      <IconTile tone="rose" size="sm">
        <HeartOutlined />
      </IconTile>
      {recorded.length === 0 ? (
        <Text type="secondary" style={{ fontSize: 12 }}>
          No vitals recorded yet
        </Text>
      ) : (
        <Space size={4} wrap split={<Text type="secondary">·</Text>}>
          {recorded.map(([label, value]) => (
            <Text key={label} style={{ fontSize: 12 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {label}{' '}
              </Text>
              <Text strong style={{ fontSize: 12 }}>
                {value}
              </Text>
            </Text>
          ))}
        </Space>
      )}
      {/* D-077 — attribution and time stay, as muted secondary information;
          the actions that used to live in a second, duplicate vitals card are
          here instead, so the values appear exactly once on the screen. */}
      <Text type="secondary" style={{ fontSize: 12, marginLeft: 'auto' }}>
        {formatClinicTime(latest.recordedAt)}
      </Text>
      {onToggleExpand && (
        <Button size="small" type="link" className="kw-vitals-action" onClick={onToggleExpand}>
          {expanded ? 'Hide' : 'Record / Edit'}
        </Button>
      )}
    </div>
  );
}
