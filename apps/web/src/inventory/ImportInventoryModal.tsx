import { useState } from 'react';
import { Alert, Button, message, Modal, Space, Table, Typography, Upload } from 'antd';
import { DownloadOutlined, InboxOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient, downloadFile, ApiError } from '../core/api-client';

const { Text, Paragraph } = Typography;

interface RowProblem {
  line: number;
  column: string;
  message: string;
}

interface ImportResult {
  dryRun: boolean;
  created: number;
  updated: number;
  needsAttention: number;
  problems: RowProblem[];
}

/**
 * THE ONBOARDING PATH — download, fill in, upload, see what is wrong, fix,
 * upload again.
 *
 * The file is CHECKED before it is applied, always, and the result of the
 * check is what the clinic sees before they commit. That is not politeness: a
 * spreadsheet of 200 medicines will have mistakes in it, and the difference
 * between "3 problems, here they are, by line" and "row 47 failed" is whether
 * the clinic makes one pass through the file or forty-seven.
 *
 * Nothing partial is ever written — the server refuses the whole file while
 * anything in it is wrong — so Apply is only offered on a clean check.
 */
export function ImportInventoryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [checked, setChecked] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();

  const reset = () => {
    setCsv(null);
    setFileName(null);
    setChecked(null);
  };

  const run = async (dryRun: boolean) => {
    if (!csv) return;
    setBusy(true);
    try {
      const result = await apiClient.post<ImportResult>('/items/csv-import', { csv, dryRun });
      setChecked(result);
      if (!dryRun && result.problems.length === 0) {
        message.success(`${result.created} added, ${result.updated} updated.`);
        queryClient.invalidateQueries({ queryKey: ['items'] });
        queryClient.invalidateQueries({ queryKey: ['item-categories'] });
        reset();
        onClose();
      }
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Could not read that file');
    } finally {
      setBusy(false);
    }
  };

  const clean = checked !== null && checked.problems.length === 0;

  return (
    <Modal
      open={open}
      title="Import inventory from a spreadsheet"
      width={720}
      destroyOnHidden
      onCancel={() => {
        reset();
        onClose();
      }}
      footer={[
        <Button key="cancel" onClick={onClose}>
          Cancel
        </Button>,
        <Button key="check" disabled={!csv} loading={busy && !clean} onClick={() => run(true)}>
          Check file
        </Button>,
        <Button
          key="apply"
          type="primary"
          // Only after a clean check. The server refuses a file with problems
          // anyway; offering the button would be inviting a refusal.
          disabled={!clean}
          loading={busy}
          onClick={() => run(false)}
        >
          Apply
        </Button>,
      ]}
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          The template has one row per medicine and the same columns as the item form. Where an item is handed over
          whole rather than counted out — a bottle, a tube — write <Text code>DISPENSED_WHOLE</Text> in the quantity
          column instead of a number. Uploading again updates medicines by name; it does not create second copies.
        </Paragraph>

        <Button
          icon={<DownloadOutlined />}
          onClick={() => downloadFile('/items/csv-template', 'kuwick-inventory-template.csv')}
        >
          Download template
        </Button>

        <Upload.Dragger
          accept=".csv,text/csv"
          maxCount={1}
          showUploadList={false}
          // Read in the browser and posted as text. The file is a few hundred
          // rows of ASCII; a multipart parser on the API for one screen would
          // be a dependency and an upload-size policy nobody asked for.
          beforeUpload={async (file) => {
            setCsv(await file.text());
            setFileName(file.name);
            setChecked(null);
            return false;
          }}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">{fileName ?? 'Choose a CSV, or drop one here'}</p>
        </Upload.Dragger>

        {checked && checked.problems.length > 0 && (
          <>
            <Alert
              type="error"
              showIcon
              message={`${checked.problems.length} ${checked.problems.length === 1 ? 'problem' : 'problems'} — nothing has been imported`}
              description="Fix these in the spreadsheet and upload it again. The whole file is applied together, so no half-imported rows are left behind."
            />
            <Table<RowProblem>
              size="small"
              rowKey={(problem) => `${problem.line}-${problem.column}`}
              dataSource={checked.problems}
              pagination={checked.problems.length > 10 ? { pageSize: 10 } : false}
              columns={[
                // The spreadsheet's own line number, header counted, so the
                // clinic can go straight to it.
                { title: 'Line', dataIndex: 'line', width: 70 },
                { title: 'Column', dataIndex: 'column', width: 190 },
                { title: 'Problem', dataIndex: 'message' },
              ]}
            />
          </>
        )}

        {clean && (
          <Alert
            type="success"
            showIcon
            message={`Ready: ${checked.created} to add, ${checked.updated} to update`}
            description={
              checked.needsAttention > 0
                ? `${checked.needsAttention} ${checked.needsAttention === 1 ? 'row has' : 'rows have'} no quantity per stock unit. They will import and appear under Needs attention — a medicine with no pack quantity cannot be priced per dispense until somebody states one.`
                : 'Every row states how it is counted.'
            }
          />
        )}
      </Space>
    </Modal>
  );
}
