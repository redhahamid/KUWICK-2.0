import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Tag,
  Typography,
  message,
} from 'antd';
import { ApiError } from '../../core/api-client';
import { OverridePanelBenefitDto, RecordPanelVerificationDto, Visit } from '../types';
import { useOverridePanelBenefit, useRecordPanelVerification } from '../hooks/useInvoices';
import { money } from './invoicePresentation';
import {
  COPAYMENT_LABEL,
  COVERAGE_LABEL,
  VERIFICATION_COLOR,
  VERIFICATION_LABEL,
} from './billingReviewPresentation';
import { formatClinicDateTime } from '../clinicTime';

const { Text } = Typography;

interface Props {
  visit: Visit;
  /** Ordinary verification capture — front desk, finance, owner. */
  canVerify: boolean;
  /** Exceptional financial correction — finance and owner only. */
  canOverride: boolean;
}

/**
 * G4.5d3c-3b2 (D-094) — the visit's stored panel benefit, and the two ways it
 * can change.
 *
 * Everything displayed is the VISIT SNAPSHOT (D-092), not the panel's current
 * configuration: a panel that changes its limit tomorrow cannot restate what
 * this visit was seen under. Verification is counter work; an override is a
 * financial correction with a mandatory reason, and front desk is refused it.
 */
export function PanelBenefitPanel({ visit, canVerify, canOverride }: Props) {
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [verifyForm] = Form.useForm<RecordPanelVerificationDto & { visitLimitAmount?: number }>();
  const [overrideForm] = Form.useForm<OverridePanelBenefitDto>();
  const verify = useRecordPanelVerification(visit.id);
  const override = useOverridePanelBenefit(visit.id);

  if (!visit.panelClinicId) {
    return (
      <Card size="small" title="Billing type">
        <Text>Self-pay — the patient carries the whole bill.</Text>
      </Card>
    );
  }

  const status = visit.panelVerificationStatus ?? 'PENDING_VERIFICATION';
  const resolved = status === 'VERIFIED' || status === 'OVERRIDDEN';
  const coverage = visit.panelCoverageType;

  const submitVerify = async (values: RecordPanelVerificationDto) => {
    try {
      await verify.mutateAsync({
        ...values,
        // An UNLIMITED plan must not carry a limit, and NONE must not carry a
        // value — the server refuses both; the form does not send them.
        visitLimitAmount: values.coverageType === 'VISIT_LIMIT' ? values.visitLimitAmount : undefined,
        copaymentValue: values.copaymentType && values.copaymentType !== 'NONE' ? values.copaymentValue : undefined,
      });
      message.success('Panel benefit recorded. Responsibility has been recalculated.');
      setVerifyOpen(false);
      verifyForm.resetFields();
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to record the panel verification');
    }
  };

  const submitOverride = async (values: OverridePanelBenefitDto) => {
    try {
      await override.mutateAsync({
        ...values,
        visitLimitAmount: values.coverageType === 'VISIT_LIMIT' ? values.visitLimitAmount : undefined,
        copaymentValue: values.copaymentType && values.copaymentType !== 'NONE' ? values.copaymentValue : undefined,
      });
      message.success('Benefit terms overridden. The original verification is retained.');
      setOverrideOpen(false);
      overrideForm.resetFields();
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to override the panel benefit');
    }
  };

  return (
    <Card
      size="small"
      title="Panel benefit"
      extra={
        <Space size={8} wrap>
          {canVerify && (
            <Button size="small" onClick={() => setVerifyOpen(true)} style={{ minHeight: 44 }}>
              {resolved ? 'Update verification' : 'Record verification'}
            </Button>
          )}
          {canOverride && (
            <Button size="small" onClick={() => setOverrideOpen(true)} style={{ minHeight: 44 }}>
              Override terms
            </Button>
          )}
        </Space>
      }
    >
      <Descriptions size="small" column={1} colon={false}>
        <Descriptions.Item label="Panel">{visit.panelClinic?.name ?? visit.billingType}</Descriptions.Item>
        <Descriptions.Item label="Verification">
          <Space size={8} wrap>
            <Tag color={VERIFICATION_COLOR[status]}>{VERIFICATION_LABEL[status]}</Tag>
            {visit.panelVerifiedAt && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {formatClinicDateTime(visit.panelVerifiedAt)}
              </Text>
            )}
          </Space>
        </Descriptions.Item>
        {visit.panelMemberReference && (
          <Descriptions.Item label="Member reference">{visit.panelMemberReference}</Descriptions.Item>
        )}
        {coverage && (
          <Descriptions.Item label="Coverage">
            {COVERAGE_LABEL[coverage]}
            {coverage === 'VISIT_LIMIT' && visit.panelVisitLimitAmount
              ? ` · ${money(visit.panelVisitLimitAmount)} per visit`
              : ''}
          </Descriptions.Item>
        )}
        {visit.panelCopaymentType && (
          <Descriptions.Item label="Copayment">
            {COPAYMENT_LABEL[visit.panelCopaymentType]}
            {visit.panelCopaymentType === 'FIXED_AMOUNT' && visit.panelCopaymentValue
              ? ` · ${money(visit.panelCopaymentValue)}`
              : ''}
            {visit.panelCopaymentType === 'PERCENTAGE' && visit.panelCopaymentValue
              ? ` · ${Number(visit.panelCopaymentValue)}%`
              : ''}
          </Descriptions.Item>
        )}
        {visit.panelBenefitOverrideReason && (
          <Descriptions.Item label="Override reason">{visit.panelBenefitOverrideReason}</Descriptions.Item>
        )}
      </Descriptions>

      {!resolved && (
        <Alert
          type="warning"
          showIcon
          role="status"
          style={{ marginTop: 8 }}
          message="Billing responsibility has not been confirmed."
          description={
            canVerify
              ? 'Verify the patient’s eligibility on the panel portal and record the terms above. Payment stays unavailable until then.'
              : 'Counter or finance staff must record the panel verification before this visit can be settled.'
          }
        />
      )}

      <Modal
        title="Record panel verification"
        open={verifyOpen}
        onCancel={() => setVerifyOpen(false)}
        onOk={() => verifyForm.submit()}
        okText="Save verification"
        confirmLoading={verify.isPending}
        destroyOnHidden
      >
        <Form form={verifyForm} layout="vertical" onFinish={submitVerify} initialValues={{ status: 'VERIFIED' }}>
          <Form.Item name="status" label="Portal result" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'VERIFIED', label: 'Verified — the panel confirmed cover' },
                { value: 'FAILED', label: 'Failed — the panel did not confirm cover' },
              ]}
            />
          </Form.Item>
          <Form.Item name="memberReference" label="Member reference">
            <Input maxLength={120} placeholder="As shown on the panel card or portal" />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, next) => prev.status !== next.status}>
            {({ getFieldValue }) =>
              getFieldValue('status') === 'VERIFIED' ? (
                <>
                  <Form.Item name="coverageType" label="Coverage" rules={[{ required: true }]}>
                    <Select
                      options={[
                        { value: 'UNLIMITED', label: 'Unlimited coverage' },
                        { value: 'VISIT_LIMIT', label: 'Limited per visit' },
                      ]}
                    />
                  </Form.Item>
                  <Form.Item
                    noStyle
                    shouldUpdate={(prev, next) => prev.coverageType !== next.coverageType}
                  >
                    {({ getFieldValue: get }) =>
                      get('coverageType') === 'VISIT_LIMIT' ? (
                        <Form.Item name="visitLimitAmount" label="Visit limit (RM)" rules={[{ required: true }]}>
                          <InputNumber min={0.01} precision={2} style={{ width: '100%' }} />
                        </Form.Item>
                      ) : null
                    }
                  </Form.Item>
                  <Form.Item name="copaymentType" label="Copayment">
                    <Select
                      allowClear
                      options={[
                        { value: 'NONE', label: 'No copayment' },
                        { value: 'FIXED_AMOUNT', label: 'Fixed amount' },
                        { value: 'PERCENTAGE', label: 'Percentage of the covered amount' },
                      ]}
                    />
                  </Form.Item>
                  <Form.Item noStyle shouldUpdate={(prev, next) => prev.copaymentType !== next.copaymentType}>
                    {({ getFieldValue: get }) =>
                      get('copaymentType') && get('copaymentType') !== 'NONE' ? (
                        <Form.Item
                          name="copaymentValue"
                          label={get('copaymentType') === 'PERCENTAGE' ? 'Copayment (%)' : 'Copayment (RM)'}
                          rules={[{ required: true }]}
                        >
                          <InputNumber min={0.01} precision={2} style={{ width: '100%' }} />
                        </Form.Item>
                      ) : null
                    }
                  </Form.Item>
                </>
              ) : (
                <Alert
                  type="info"
                  showIcon
                  message="A failed verification records no benefit terms."
                  description="Terms the panel did not confirm are not stored as if they had been."
                />
              )
            }
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Override panel benefit terms"
        open={overrideOpen}
        onCancel={() => setOverrideOpen(false)}
        onOk={() => overrideForm.submit()}
        okText="Override terms"
        confirmLoading={override.isPending}
        destroyOnHidden
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="This is a financial correction."
          description="The original verified terms are retained, along with your name, the time and your reason."
        />
        <Form form={overrideForm} layout="vertical" onFinish={submitOverride}>
          <Form.Item name="coverageType" label="Coverage" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'UNLIMITED', label: 'Unlimited coverage' },
                { value: 'VISIT_LIMIT', label: 'Limited per visit' },
              ]}
            />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, next) => prev.coverageType !== next.coverageType}>
            {({ getFieldValue }) =>
              getFieldValue('coverageType') === 'VISIT_LIMIT' ? (
                <Form.Item name="visitLimitAmount" label="Visit limit (RM)" rules={[{ required: true }]}>
                  <InputNumber min={0.01} precision={2} style={{ width: '100%' }} />
                </Form.Item>
              ) : null
            }
          </Form.Item>
          <Form.Item name="copaymentType" label="Copayment">
            <Select
              allowClear
              options={[
                { value: 'NONE', label: 'No copayment' },
                { value: 'FIXED_AMOUNT', label: 'Fixed amount' },
                { value: 'PERCENTAGE', label: 'Percentage of the covered amount' },
              ]}
            />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, next) => prev.copaymentType !== next.copaymentType}>
            {({ getFieldValue }) =>
              getFieldValue('copaymentType') && getFieldValue('copaymentType') !== 'NONE' ? (
                <Form.Item
                  name="copaymentValue"
                  label={getFieldValue('copaymentType') === 'PERCENTAGE' ? 'Copayment (%)' : 'Copayment (RM)'}
                  rules={[{ required: true }]}
                >
                  <InputNumber min={0.01} precision={2} style={{ width: '100%' }} />
                </Form.Item>
              ) : null
            }
          </Form.Item>
          <Form.Item
            name="reason"
            label="Reason"
            rules={[{ required: true, min: 3, message: 'Give a reason — it is stored with your name and the time.' }]}
          >
            <Input.TextArea rows={3} maxLength={300} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
