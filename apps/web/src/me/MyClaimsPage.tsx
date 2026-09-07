import { useState } from 'react';
import { App, Button, DatePicker, Drawer, Form, Input, InputNumber, Select, Tag, Upload } from 'antd';
import { PaperClipOutlined } from '@ant-design/icons';
import type { UploadFile } from 'antd';
import dayjs from 'dayjs';
import { ApiError } from '../core/api-client';
import { MyEmpty } from './MyKuwickLayout';
import { useAttachReceipt, useMyClaims, useSubmitClaim } from './hooks/useMe';

const CATEGORIES = [
  { value: 'MEDICAL', label: 'Medical' },
  { value: 'TRAVEL', label: 'Travel' },
  { value: 'MEAL', label: 'Meals' },
  { value: 'TRAINING', label: 'Training' },
  { value: 'EQUIPMENT', label: 'Equipment' },
  { value: 'PROFESSIONAL_FEE', label: 'Professional fee' },
  { value: 'OTHER', label: 'Other' },
];

const STATUS_TAG: Record<string, string> = {
  DRAFT: 'default',
  SUBMITTED: 'blue',
  APPROVED: 'green',
  REJECTED: 'red',
  CANCELLED: 'default',
};

/**
 * MY CLAIMS — submit a receipt, and be told in plain words where the money is.
 *
 * The status an employee reads is a SENTENCE, not the internal routing. Nobody
 * photographing a receipt in a car park should have to learn the difference
 * between a payment route and a payout status; what they need to know is
 * "paid with your salary" or "the clinic will reimburse you separately".
 *
 * Which of those it is stays the manager's decision, and the double-payment
 * guard behind it is a unique constraint in the database rather than anything
 * this screen enforces.
 */
export function MyClaimsPage() {
  const { message } = App.useApp();
  const { data, isLoading } = useMyClaims();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const submit = useSubmitClaim();
  const attach = useAttachReceipt();
  const [receipt, setReceipt] = useState<UploadFile | null>(null);

  const send = async () => {
    const values = await form.validateFields();
    try {
      const claim = await submit.mutateAsync({
        category: values.category,
        amountClaimed: Number(values.amount).toFixed(2),
        claimDate: values.claimDate.format('YYYY-MM-DD'),
        description: values.description,
      });
      // The receipt follows the claim, so a failed upload leaves a claim a
      // manager can still see and ask about rather than nothing at all.
      if (receipt?.originFileObj) {
        await attach.mutateAsync({
          claimId: claim.id,
          fileName: receipt.name,
          filePath: `claims/${claim.id}/${receipt.name}`,
          mimeType: receipt.type ?? 'application/octet-stream',
          fileSize: receipt.size ?? 1,
        });
      }
      message.success('Sent to your manager.');
      setOpen(false);
      form.resetFields();
      setReceipt(null);
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Could not send that.');
    }
  };

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <h1 className="kw-my__title">My claims</h1>
          <p className="kw-my__subtitle">Money you have spent that the clinic owes you back.</p>
        </div>
        <Button type="primary" size="large" onClick={() => setOpen(true)}>
          New claim
        </Button>
      </div>

      <div className="kw-my-card kw-my-card--flush">
        {isLoading ? null : (data?.length ?? 0) === 0 ? (
          <MyEmpty title="No claims yet">
            Photograph a receipt and send it here. Nothing is wrong — you simply have not claimed anything.
          </MyEmpty>
        ) : (
          data?.map((claim) => (
            <div className="kw-my-row" key={claim.id}>
              <div className="kw-my-row__main">
                <span className="kw-my-row__title">{claim.description}</span>
                <span className="kw-my-row__detail">
                  {CATEGORIES.find((c) => c.value === claim.category)?.label ?? claim.category} ·{' '}
                  {dayjs(claim.claimDate).format('D MMM YYYY')}
                  {claim.attachments.length > 0 ? ` · ${claim.attachments.length} receipt` : ' · no receipt'}
                </span>
                {/* The sentence, not the routing. */}
                <span className="kw-my-row__detail">{claim.whereTheMoneyIs}</span>
              </div>
              <div className="kw-my-row__side">
                <span className="kw-my-money">RM{Number(claim.amountClaimed).toFixed(2)}</span>
                <Tag color={STATUS_TAG[claim.status] ?? 'default'}>{claim.status.toLowerCase()}</Tag>
                {claim.amountApproved && claim.amountApproved !== claim.amountClaimed ? (
                  <span className="kw-my-row__detail">approved RM{Number(claim.amountApproved).toFixed(2)}</span>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="New claim"
        placement="bottom"
        height="auto"
        destroyOnHidden
      >
        <Form form={form} layout="vertical" className="kw-my-form" initialValues={{ claimDate: dayjs() }}>
          <Form.Item name="category" label="What is it for" rules={[{ required: true }]}>
            <Select options={CATEGORIES} size="large" placeholder="Choose" />
          </Form.Item>
          <Form.Item
            name="amount"
            label="Amount (RM)"
            rules={[{ required: true, message: 'How much?' }]}
          >
            {/* `decimal` so a phone shows the numeric keypad with a point. */}
            <InputNumber
              style={{ width: '100%' }}
              size="large"
              min={0.01}
              step={0.05}
              precision={2}
              inputMode="decimal"
              placeholder="45.50"
            />
          </Form.Item>
          <Form.Item name="claimDate" label="Date on the receipt" rules={[{ required: true }]}>
            <DatePicker style={{ width: '100%' }} size="large" format="D MMM YYYY" />
          </Form.Item>
          <Form.Item
            name="description"
            label="What happened"
            rules={[{ required: true, min: 3, message: 'A manager has to know what they are approving.' }]}
          >
            <Input.TextArea rows={3} placeholder="Taxi to the branch for the Saturday clinic." />
          </Form.Item>
          <Form.Item label="Receipt">
            <Upload
              // Held until the claim exists, then attached to it. `capture`
              // opens the camera directly, which is how a receipt actually
              // reaches this form.
              accept="image/*,application/pdf"
              maxCount={1}
              beforeUpload={() => false}
              fileList={receipt ? [receipt] : []}
              onChange={({ fileList }) => setReceipt(fileList[0] ?? null)}
              onRemove={() => setReceipt(null)}
            >
              <Button icon={<PaperClipOutlined />} size="large" block>
                Take a photo or choose a file
              </Button>
            </Upload>
          </Form.Item>
          <div className="kw-my-form__footer">
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="primary" loading={submit.isPending || attach.isPending} onClick={send}>
              Send claim
            </Button>
          </div>
        </Form>
      </Drawer>
    </>
  );
}
