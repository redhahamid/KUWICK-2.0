import { useState } from 'react';
import { Button, Space } from 'antd';
import { Visit } from '../types';
import { DiagnosisSection } from './DiagnosisSection';
import { OrdersSection } from './OrdersSection';
import { MedicationsSection } from './MedicationsSection';
import { DocumentsSection } from './DocumentsSection';
import { InvoiceSection } from './InvoiceSection';

type SectionKey = 'diagnosis' | 'orders' | 'medications' | 'documents' | 'invoice';

const ALL: SectionKey[] = ['diagnosis', 'orders', 'medications', 'documents', 'invoice'];

interface ClinicalSectionStackProps {
  visit: Visit;
  patientName?: string;
  patientIdentifier?: string;
}

// G1 (D-058) — the five clinical sections, full width, in clinical order,
// below the note. This replaces the four equal-height dashboard cards.
//
// Sections open independently rather than accordion-style: a doctor
// prescribing while reading the diagnosis they just entered should not have
// one close because the other opened. All start collapsed so the record opens
// as a readable summary rather than a wall of forms.
export function ClinicalSectionStack({ visit, patientName, patientIdentifier }: ClinicalSectionStackProps) {
  const [open, setOpen] = useState<Set<SectionKey>>(new Set());

  const toggle = (key: SectionKey) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const isOpen = (key: SectionKey) => open.has(key);

  return (
    <div className="kw-section-stack">
      <Space size={4} style={{ justifyContent: 'flex-end', width: '100%' }}>
        <Button size="small" type="text" onClick={() => setOpen(new Set(ALL))}>
          Expand all
        </Button>
        <Button size="small" type="text" onClick={() => setOpen(new Set())}>
          Collapse all
        </Button>
      </Space>

      <DiagnosisSection visitId={visit.id} expanded={isOpen('diagnosis')} onToggle={() => toggle('diagnosis')} />
      <OrdersSection visitId={visit.id} expanded={isOpen('orders')} onToggle={() => toggle('orders')} />
      <MedicationsSection visitId={visit.id} expanded={isOpen('medications')} onToggle={() => toggle('medications')} />
      <DocumentsSection
        visit={visit}
        patientName={patientName}
        patientIdentifier={patientIdentifier}
        expanded={isOpen('documents')}
        onToggle={() => toggle('documents')}
      />
      <InvoiceSection visit={visit} expanded={isOpen('invoice')} onToggle={() => toggle('invoice')} />
    </div>
  );
}
