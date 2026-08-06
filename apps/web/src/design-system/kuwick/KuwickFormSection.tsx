import { ReactNode } from 'react';
import { Typography } from 'antd';

const { Text } = Typography;

/**
 * G4.5d5b-1 — a labelled group of fields inside a modal.
 *
 * A clinical form with twelve fields in one undifferentiated column is a form
 * people fill in wrongly. This groups them under a quiet heading — quiet on
 * purpose: the heading orients, the fields are the content, and a heavy
 * section header competes with the data.
 *
 * A plain <section> with a real heading rather than a Card, so a modal does
 * not end up as boxes inside boxes inside a box.
 */
export interface KuwickFormSectionProps {
  title?: string;
  /** One short line. Never instructions the field label should carry. */
  hint?: ReactNode;
  children: ReactNode;
}

export function KuwickFormSection({ title, hint, children }: KuwickFormSectionProps) {
  return (
    <section className="kw-form-section" aria-label={title}>
      {title && (
        <div className="kw-form-section-head">
          <Text strong className="kw-form-section-title">
            {title}
          </Text>
          {hint && (
            <Text type="secondary" className="kw-form-section-hint">
              {hint}
            </Text>
          )}
        </div>
      )}
      {children}
    </section>
  );
}
