import { useState } from 'react';
import { App, Alert, Button, Input, Select, Tag, Upload } from 'antd';
import { AdminNotice, AdminSection, AdminShell, firstError } from '../components/AdminShell';
import { StatStrip } from '../components/StatStrip';
import { DataTable, money } from '../components/DataTable';
import { useClaimImportBatches, useImportClaims, usePanelConfigs } from '../hooks/useAdmin';
import { useClinics } from '../../core/hooks/useClinics';
import { FEE_TREATMENT_LABEL } from '../types';
import type { ClaimImportBatchRow, ClaimImportResult, ImportRowProblem, PanelConfigRow } from '../types';

/**
 * IMPORTING THE CLAIM WORKBOOK (G-12).
 *
 * The last thing standing between the clinic and closing that file. Thousands
 * of open and historical claims, a third of them unpaid, all of them money
 * somebody is still owed — and Kuwick cannot start empty on cutover day.
 *
 * The screen is built around the one thing that makes an import trustworthy:
 * **you see the money before you commit it.** The upload runs as a dry run, the
 * totals appear beside the workbook's own figures, and the commit button only
 * appears once there is nothing wrong with the file. An importer that writes
 * first and reports afterwards is a faster way to get wrong numbers in.
 */
export function ClaimImportPage() {
  const { message } = App.useApp();
  const [panelClinicId, setPanelClinicId] = useState<string | undefined>();
  const [clinicId, setClinicId] = useState<string | undefined>();
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState<string | undefined>();
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<ClaimImportResult | null>(null);

  const panels = usePanelConfigs();
  const { data: clinics } = useClinics();
  const batches = useClaimImportBatches(panelClinicId);
  const runImport = useImportClaims();

  const panelOptions = (panels.data ?? []).map((panel: PanelConfigRow) => ({ value: panel.id, label: panel.name }));
  const chosenPanel = (panels.data ?? []).find((panel: PanelConfigRow) => panel.id === panelClinicId);

  const check = () => {
    if (!panelClinicId || !csv) return;
    runImport.mutate(
      { panelClinicId, clinicId, csv, fileName },
      {
        onSuccess: (result) => setPreview(result),
        onError: (error) => message.error((error as Error).message),
      },
    );
  };

  const commit = () => {
    if (!panelClinicId || !csv) return;
    runImport.mutate(
      { panelClinicId, clinicId, csv, fileName, note: note || undefined, commit: true },
      {
        onSuccess: (result) => {
          setPreview(result);
          if (!result.dryRun) {
            message.success(`${result.importable} claim(s) imported.`);
            setCsv('');
            setFileName(undefined);
            setNote('');
          }
        },
        onError: (error) => message.error((error as Error).message),
      },
    );
  };

  const clean = preview !== null && preview.problems.length === 0;
  const committed = preview !== null && preview.dryRun === false;

  return (
    <AdminShell
      error={firstError(panels, batches)}
      title="Import claims from the previous system"
      subtitle="Kuwick cannot start empty on the day you switch over. Load the open and historical claims here, check the totals against your own workbook, and only then commit."
      actions={
        <Button
          size="small"
          href="/api/panel-workspace/import/template"
          target="_blank"
          rel="noreferrer"
        >
          Download the template
        </Button>
      }
    >
      <AdminNotice tone="info">
        <strong>Nothing is written until you say so.</strong> Checking the file does the whole job —
        it validates every row, works out what each claim is worth using this panel's own fee rule,
        and then throws the result away. The commit button appears only when there is nothing wrong
        with the file.
      </AdminNotice>

      <AdminSection title="1 · The file" description="One panel per file. A claim number means nothing without the panel that issued it.">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <Select
            style={{ minWidth: 260 }}
            placeholder="Which panel are these claims for?"
            value={panelClinicId}
            onChange={(value) => {
              setPanelClinicId(value);
              setPreview(null);
            }}
            options={panelOptions}
          />
          {/*
            AN IMPORTED CLAIM HAS NO VISIT, so it has no branch of its own, and
            every branch-scoped finance screen reads the branch from the visit.
            Leave this blank and the claims are reported as not attributable to
            a branch — which is honest, but means they sit outside the per-branch
            figures. The person importing usually knows.
          */}
          <Select
            style={{ minWidth: 220 }}
            allowClear
            placeholder="Which branch? (optional)"
            value={clinicId}
            onChange={(value) => {
              setClinicId(value);
              setPreview(null);
            }}
            options={(clinics ?? []).map((clinic) => ({ value: clinic.id, label: clinic.name }))}
          />
          <Upload
            accept=".csv,text/csv"
            maxCount={1}
            showUploadList={false}
            beforeUpload={(file) => {
              const reader = new FileReader();
              reader.onload = () => {
                setCsv(String(reader.result ?? ''));
                setFileName(file.name);
                setPreview(null);
              };
              reader.readAsText(file);
              return false;
            }}
          >
            <Button>{fileName ?? 'Choose a CSV'}</Button>
          </Upload>
          <Button type="primary" disabled={!panelClinicId || !csv} loading={runImport.isPending} onClick={check}>
            Check the file
          </Button>
        </div>
        {chosenPanel && !clinicId ? (
          <div style={{ marginTop: 10, fontSize: 12, color: '#d46b08' }}>
            No branch chosen. These claims will be imported and chased normally, but they will sit
            outside the per-branch figures on Finance → Panel money, because an imported claim has
            no visit to read a branch from.
          </div>
        ) : null}
        {chosenPanel ? (
          <div style={{ marginTop: 10, fontSize: 12, color: '#595959' }}>
            Every imported claim will be stamped{' '}
            <Tag>{FEE_TREATMENT_LABEL[chosenPanel.feeTreatment]}</Tag> — taken from this panel's
            configuration, never from a column in the file.
          </div>
        ) : null}
      </AdminSection>

      {preview ? (
        <AdminSection
          title="2 · What the file says"
          description="Compare these against your workbook's own totals. This comparison is the only thing that proves the import is right, and it cannot be made afterwards."
        >
          {committed ? (
            <Alert
              type="success"
              showIcon
              style={{ marginBottom: 12 }}
              message={`${preview.importable} claim(s) imported.`}
              description="They are now in the claim workspace and on the panel dashboard, and they carry this import so they can be traced back to it."
            />
          ) : null}

          <StatStrip
            stats={[
              {
                label: 'Rows in the file',
                value: String(preview.rowCount),
                hint: `${preview.importable} to import · ${preview.alreadyPresent} already here`,
              },
              { label: 'Claimed', value: money(preview.totals.claimed) },
              {
                label: 'Fees',
                value: money(preview.totals.fee),
                hint: FEE_TREATMENT_LABEL[preview.feeTreatment],
              },
              {
                label: 'Expected receivable',
                value: money(preview.totals.expectedReceivable),
                explain:
                  "Claimed, adjusted by this panel's fee rule. This is the figure to check against the workbook's TOTAL row.",
              },
              { label: 'Already received', value: money(preview.totals.received) },
              {
                label: 'Still outstanding',
                value: money(preview.totals.outstanding),
                tone: preview.totals.outstanding > 0 ? 'warn' : 'good',
              },
            ]}
          />

          {preview.alreadyPresent > 0 ? (
            <AdminNotice tone="info">
              {preview.alreadyPresent} claim(s) in this file are already in Kuwick and will be left
              alone. Re-uploading a file after fixing a few rows imports only those rows.
            </AdminNotice>
          ) : null}

          {preview.problems.length > 0 ? (
            <>
              <AdminNotice tone="warn">
                <strong>Nothing has been imported.</strong> {preview.problems.length} problem(s) —
                every one of them, so you can fix the spreadsheet in a single pass rather than one
                round trip per mistake. Correct the file and check it again.
              </AdminNotice>
              <DataTable<ImportRowProblem>
                rows={preview.problems}
                rowKey={(row) => `${row.line}-${row.column}`}
                exportName="claim-import-problems"
                emptyText=""
                columns={[
                  { title: 'Line', dataIndex: 'line', key: 'line', align: 'right' },
                  { title: 'Column', dataIndex: 'column', key: 'column' },
                  { title: 'What is wrong', dataIndex: 'message', key: 'message' },
                ]}
              />
            </>
          ) : null}

          {clean && !committed && preview.importable > 0 ? (
            <div style={{ marginTop: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <Input
                style={{ maxWidth: 420 }}
                placeholder="Why this import was run — for whoever reads this next year"
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
              <Button type="primary" danger loading={runImport.isPending} onClick={commit}>
                The totals match — import {preview.importable} claim(s)
              </Button>
            </div>
          ) : null}

          {clean && !committed && preview.importable === 0 ? (
            <AdminNotice tone="info">
              Every claim in this file is already in Kuwick. Nothing to do.
            </AdminNotice>
          ) : null}
        </AdminSection>
      ) : null}

      <AdminSection
        title="Imports so far"
        description="Every run, with the totals as they stood. An import that turns out to be wrong can be found by this list."
      >
        <DataTable<ClaimImportBatchRow>
          rows={batches.data}
          loading={batches.isLoading}
          rowKey="id"
          exportName="claim-imports"
          emptyText="Nothing has been imported yet"
          columns={[
            {
              title: 'When',
              dataIndex: 'importedAt',
              key: 'importedAt',
              render: (value: string) => new Date(value).toLocaleString(),
            },
            { title: 'Panel', dataIndex: 'panelName', key: 'panelName' },
            {
              title: 'Branch',
              dataIndex: 'clinicName',
              key: 'clinicName',
              render: (value: string | null) =>
                value ?? <span style={{ color: '#8c8c8c' }}>not stated</span>,
            },
            { title: 'File', dataIndex: 'fileName', key: 'fileName', render: (v: string | null) => v ?? '—' },
            { title: 'By', dataIndex: 'importedBy', key: 'importedBy' },
            { title: 'Imported', dataIndex: 'importedCount', key: 'importedCount', align: 'right' },
            { title: 'Skipped', dataIndex: 'skippedCount', key: 'skippedCount', align: 'right' },
            { title: 'Claimed', dataIndex: 'claimedTotal', key: 'claimedTotal', align: 'right', render: money },
            { title: 'Expected', dataIndex: 'expectedTotal', key: 'expectedTotal', align: 'right', render: money },
            { title: 'Received', dataIndex: 'receivedTotal', key: 'receivedTotal', align: 'right', render: money },
            {
              title: 'Outstanding at import',
              dataIndex: 'outstandingTotal',
              key: 'outstandingTotal',
              align: 'right',
              render: money,
            },
            { title: 'Note', dataIndex: 'note', key: 'note', render: (v: string | null) => v ?? '—' },
          ]}
        />
      </AdminSection>
    </AdminShell>
  );
}
