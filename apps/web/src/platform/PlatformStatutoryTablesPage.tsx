import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import dayjs from "dayjs";
import { platformApi } from "./api";
import { ApiError } from "../core/api-client";

const { Title, Text } = Typography;

interface BuiltInRow {
  id: string;
  scheme: string;
  document: string;
  section: string;
  inForceFrom: string;
  verification: string;
  contentHash: string;
}
interface VersionRow {
  id: string;
  scheme: string;
  year: number;
  inForceFrom: string;
  sourceDocument: string;
  sourceUrl: string | null;
  note: string | null;
  contentHash: string;
  createdAt: string;
  createdBy: string;
  readable: boolean;
  summary: string;
}
interface Listing {
  schemes: string[];
  builtIn: BuiltInRow[];
  versions: VersionRow[];
}

const SCHEME_LABEL: Record<string, string> = {
  EPF: "EPF — Third Schedule (KWSP)",
  SOCSO: "SOCSO — Act 4 rate table (PERKESO)",
  EIS: "EIS — Act 800 rate table (PERKESO)",
  LINDUNG: "LINDUNG 24 JAM — SKBBK (PERKESO)",
  PCB: "PCB — MTD specification (HASiL)",
  HRD_LEVY: "HRD Corp levy rates",
};

const SHAPES: Record<string, string> = {
  EPF: '{ "ceilingCents": 2000000, "parts": [ { "part": "A", "appliesTo": "…", "aboveCeiling": { "employerPercent": 12, "employeePercent": 11 }, "bands": [ [fromCents, toCents, employerCents, employeeCents], … ] }, …C, E, F ] }',
  SOCSO:
    '{ "ceilingCents": 600000, "bands": [ [fromCents, toCents|null, cat1EmployerCents, cat1EmployeeCents, cat1EmployeeNonInjuryCents, cat2EmployerCents, cat2EmployeeNonInjuryCents], … ] }',
  EIS: '{ "ceilingCents": 600000, "bands": [ [fromCents, toCents|null, employerCents, employeeCents], … ] }',
  LINDUNG:
    '{ "effectiveFrom": "2026-06-01", "phaseRatesPercent": { "PHASE_1": 0.75, "PHASE_2": 1, "PHASE_3": 1.25 } }',
  PCB: '{ "table1": [ { "fromCents", "toCents"|null, "mCents", "ratePercent", "bCategory13Cents", "bCategory2Cents" }, … ], "individualCents", "spouseCents", "perChildCents", "disabledSelfCents", "disabledSpouseCents", "epfReliefCapCents", "nonResidentRatePercent", "minimumCents" }',
  HRD_LEVY: '{ "mandatoryPercent": 1, "optionalPercent": 0.5 }',
};

interface FormValues {
  scheme: string;
  year: number;
  inForceFrom: dayjs.Dayjs;
  sourceDocument: string;
  sourceUrl?: string;
  note?: string;
  content: string;
}

/**
 * STATUTORY TABLES — the platform's register of editions.
 *
 * What Kuwick ships is transcribed in code and verified against the
 * authorities' worked examples; it is listed here as the built-in line. When
 * a later edition is gazetted, the owner adds it as data — the same shape
 * the engines read, with the source document, the year and the date it is
 * in force from — and every clinic's payroll resolves to it from that date.
 * Clinics see the edition in force for a month on their own Statutory rates
 * screen; nothing here is theirs to type.
 */
export function PlatformStatutoryTablesPage() {
  const queryClient = useQueryClient();
  const [form] = Form.useForm<FormValues>();
  const [adding, setAdding] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const listing = useQuery({
    queryKey: ["platform", "statutory-tables"],
    queryFn: () => platformApi.get<Listing>("/platform/statutory-tables"),
  });

  const create = useMutation({
    mutationFn: (values: FormValues) => {
      let content: unknown;
      try {
        content = JSON.parse(values.content);
      } catch {
        throw new ApiError("The content is not valid JSON.", 400, null);
      }
      return platformApi.post<VersionRow>("/platform/statutory-tables", {
        scheme: values.scheme,
        year: values.year,
        inForceFrom: values.inForceFrom.format("YYYY-MM-DD"),
        sourceDocument: values.sourceDocument,
        sourceUrl: values.sourceUrl || undefined,
        note: values.note || undefined,
        content,
      });
    },
    onSuccess: (row) => {
      message.success(
        `${row.scheme} edition in force from ${row.inForceFrom} added.`,
      );
      setAdding(false);
      setProblems([]);
      form.resetFields();
      queryClient.invalidateQueries({
        queryKey: ["platform", "statutory-tables"],
      });
    },
    onError: (error) => {
      const body =
        error instanceof ApiError
          ? (error.body as { problems?: string[] } | null)
          : null;
      setProblems(
        body?.problems ?? [
          error instanceof ApiError
            ? error.message
            : "The edition was not added.",
        ],
      );
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      platformApi.delete<{ deleted: boolean }>(
        `/platform/statutory-tables/${id}`,
      ),
    onSuccess: () => {
      message.success("Edition withdrawn.");
      queryClient.invalidateQueries({
        queryKey: ["platform", "statutory-tables"],
      });
    },
    onError: (error) =>
      message.error(
        error instanceof ApiError
          ? error.message
          : "The edition could not be withdrawn.",
      ),
  });

  const today = dayjs().format("YYYY-MM-DD");
  const data = listing.data;
  const schemes = data?.schemes ?? Object.keys(SCHEME_LABEL);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 16px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div>
          <Title level={3} style={{ marginBottom: 4 }}>
            Statutory tables
          </Title>
          <Text type="secondary">
            The editions every clinic’s payroll is priced on. Built-in editions
            are verified in code; add a later one here when it is gazetted, with
            its source document and the date it is in force from. A month
            resolves to the edition in force on its last day.
          </Text>
        </div>
        <Button type="primary" onClick={() => setAdding(true)}>
          Add an edition
        </Button>
      </div>
      {listing.error ? (
        <Alert
          type="error"
          showIcon
          style={{ marginTop: 16 }}
          message={
            listing.error instanceof Error
              ? listing.error.message
              : "Could not load the register."
          }
        />
      ) : null}
      {schemes.map((scheme) => {
        const builtIn = (data?.builtIn ?? []).filter(
          (row) => row.scheme === scheme,
        );
        const versions = (data?.versions ?? []).filter(
          (row) => row.scheme === scheme,
        );
        return (
          <Card
            key={scheme}
            title={SCHEME_LABEL[scheme] ?? scheme}
            style={{ marginTop: 16 }}
            size="small"
          >
            <Table
              size="small"
              pagination={false}
              rowKey="id"
              dataSource={[
                ...builtIn.map((row) => ({
                  id: row.id,
                  kind: "Built in",
                  year: row.inForceFrom.slice(0, 4),
                  inForceFrom: row.inForceFrom,
                  document: row.document,
                  detail: row.section,
                  who: `Verified: ${row.verification.toLowerCase().replace(/_/g, " ")}`,
                  platform: null as VersionRow | null,
                })),
                ...versions.map((row) => ({
                  id: row.id,
                  kind: "Platform",
                  year: String(row.year),
                  inForceFrom: row.inForceFrom,
                  document: row.sourceDocument,
                  detail: row.summary,
                  who: `${row.createdBy}, ${dayjs(row.createdAt).format("D MMM YYYY")}${row.note ? ` · ${row.note}` : ""}`,
                  platform: row,
                })),
              ].sort((a, b) => b.inForceFrom.localeCompare(a.inForceFrom))}
              columns={[
                {
                  title: "Edition",
                  dataIndex: "kind",
                  render: (kind: string, row) => (
                    <Tag color={kind === "Platform" ? "blue" : "default"}>
                      {kind}
                      {row.platform && !row.platform.readable
                        ? " · unreadable"
                        : ""}
                    </Tag>
                  ),
                },
                { title: "Year", dataIndex: "year" },
                { title: "In force from", dataIndex: "inForceFrom" },
                {
                  title: "Source document",
                  dataIndex: "document",
                  render: (document: string, row) =>
                    row.platform?.sourceUrl ? (
                      <a
                        href={row.platform.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {document}
                      </a>
                    ) : (
                      document
                    ),
                },
                { title: "Detail", dataIndex: "detail" },
                { title: "Recorded", dataIndex: "who" },
                {
                  title: "",
                  render: (_: unknown, row) =>
                    row.platform && row.inForceFrom > today ? (
                      <Button
                        size="small"
                        danger
                        onClick={() =>
                          Modal.confirm({
                            title: "Withdraw this edition?",
                            content:
                              "It is not yet in force, so no month has been priced on it.",
                            okText: "Withdraw",
                            onOk: () => remove.mutate(row.id),
                          })
                        }
                      >
                        Withdraw
                      </Button>
                    ) : null,
                },
              ]}
            />
          </Card>
        );
      })}

      <Modal
        open={adding}
        title="Add a statutory edition"
        okText="Add edition"
        confirmLoading={create.isPending}
        width={760}
        onCancel={() => {
          setAdding(false);
          setProblems([]);
        }}
        onOk={() =>
          form
            .validateFields()
            .then((values) => create.mutate(values))
            .catch(() => undefined)
        }
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ scheme: "EPF", year: dayjs().year() + 1 }}
        >
          <Form.Item name="scheme" label="Scheme" rules={[{ required: true }]}>
            <Select
              options={schemes.map((scheme) => ({
                value: scheme,
                label: SCHEME_LABEL[scheme] ?? scheme,
              }))}
            />
          </Form.Item>
          <Form.Item shouldUpdate noStyle>
            {() => (
              <Text
                type="secondary"
                style={{
                  display: "block",
                  marginBottom: 12,
                  fontFamily: "monospace",
                  fontSize: 12,
                }}
              >
                {SHAPES[form.getFieldValue("scheme") as string] ?? ""}
              </Text>
            )}
          </Form.Item>
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}
          >
            <Form.Item name="year" label="Year" rules={[{ required: true }]}>
              <InputNumber min={2020} max={2100} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item
              name="inForceFrom"
              label="In force from"
              rules={[{ required: true }]}
            >
              <DatePicker style={{ width: "100%" }} />
            </Form.Item>
          </div>
          <Form.Item
            name="sourceDocument"
            label="Source document"
            rules={[{ required: true, min: 3 }]}
          >
            <Input placeholder="e.g. EPF Act 1991, Third Schedule, in force from 1 January 2027" />
          </Form.Item>
          <Form.Item name="sourceUrl" label="Source link (optional)">
            <Input placeholder="https://…" />
          </Form.Item>
          <Form.Item name="note" label="Note (optional)">
            <Input placeholder="e.g. Gazette P.U. (A) 123/2026" />
          </Form.Item>
          <Form.Item
            name="content"
            label="Content (JSON, in the shape above)"
            rules={[{ required: true }]}
          >
            <Input.TextArea
              rows={10}
              style={{ fontFamily: "monospace", fontSize: 12 }}
              placeholder="Paste the edition as JSON"
            />
          </Form.Item>
        </Form>
        {problems.length > 0 ? (
          <Alert
            type="error"
            showIcon
            message="The edition was not added"
            description={
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            }
          />
        ) : null}
      </Modal>
    </div>
  );
}
