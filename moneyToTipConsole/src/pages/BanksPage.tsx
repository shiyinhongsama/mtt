import { App as AntdApp, Button, Card, Dropdown, Form, Input, Modal, Popconfirm, Table, Tag, Upload } from "antd";
import { useCallback, useEffect, useState } from "react";
import { api, getToken } from "../api";
import type { QuestionBank } from "../types";

/** 题库管理：名称 + 备注，题目的一级容器 */
interface BankImportReport {
  bank: string;
  created: number;
  duplicates: number;
  by_status: Record<string, number>;
  invalid: { line: number; reason: string }[];
  needs_review: { line: number; stem: string; reasons: string[] }[];
  truncated: boolean;
}

type BankExportFormat = "json" | "csv";

export default function BanksPage() {
  const { message } = AntdApp.useApp();
  const [banks, setBanks] = useState<QuestionBank[]>([]);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<{ open: boolean; bank: QuestionBank | null }>({
    open: false, bank: null,
  });
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importBank, setImportBank] = useState<QuestionBank | null>(null);
  const [report, setReport] = useState<BankImportReport | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setBanks(await api<QuestionBank[]>("/questions/banks"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load().catch((e) => message.error(e.message));
  }, [load, message]);

  const save = async () => {
    const v = await form.validateFields();
    setBusy(true);
    try {
      if (edit.bank) {
        await api(`/questions/banks/${edit.bank.id}`, { method: "PATCH", body: v });
        message.success("已保存");
      } else {
        await api("/questions/banks", { method: "POST", body: v });
        message.success("题库已创建");
      }
      setEdit({ open: false, bank: null });
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (b: QuestionBank) => {
    try {
      await api(`/questions/banks/${b.id}`, { method: "DELETE" });
      message.success(`已删除「${b.name}」，题目移入默认题库`);
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "删除失败");
    }
  };

  const download = async (bank: QuestionBank, format: BankExportFormat) => {
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/questions/banks/${bank.id}/export?format=${format}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!response.ok) throw new Error("导出失败");
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `题库-${bank.name}-${new Date().toISOString().slice(0, 10)}.${format}`;
      anchor.click();
      URL.revokeObjectURL(url);
      message.success(`已导出「${bank.name}」（${format.toUpperCase()}）`);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "导出失败");
    } finally {
      setBusy(false);
    }
  };

  const closeImport = () => {
    setImportBank(null);
    setReport(null);
  };

  const importFile = async (file: File): Promise<BankImportReport> => {
    if (!importBank) throw new Error("请先选择题库");
    setImporting(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(`/api/v1/questions/banks/${importBank.id}/import`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken()}` },
        body: form,
      });
      const data = await response.json().catch(() => ({})) as BankImportReport & { detail?: string };
      if (!response.ok) throw new Error(data.detail ?? "导入失败");
      setReport(data);
      // 报告已经拿到，刷新列表失败不应把成功导入误报为失败
      await load().catch(() => undefined);
      return data;
    } finally {
      setImporting(false);
    }
  };

  return (
    <Card title="题库列表"
      extra={<Button type="primary" onClick={() => { form.resetFields(); setEdit({ open: true, bank: null }); }}>
        新建题库
      </Button>}>
      <Table<QuestionBank>
        rowKey="id"
        size="middle"
        loading={loading}
        dataSource={banks}
        pagination={false}
        columns={[
          { title: "#", dataIndex: "id", width: 64 },
          { title: "名称", dataIndex: "name",
            render: (v: string, b) => (
              <>{v} {b.is_default && <Tag color="blue">默认</Tag>}</>
            ) },
          { title: "备注", dataIndex: "description", ellipsis: true,
            render: (v: string) => v || "—" },
          { title: "在库题目", dataIndex: "question_count", width: 100 },
          { title: "创建时间", dataIndex: "created_at", width: 180,
            render: (v: string) => new Date(v).toLocaleString("zh-CN") },
          {
            title: "操作", key: "actions", width: 280,
            render: (_, b) => (
              <>
                <Button type="link" size="small" onClick={() => {
                  form.setFieldsValue({ name: b.name, description: b.description });
                  setEdit({ open: true, bank: b });
                }}>编辑</Button>
                <Dropdown
                  menu={{
                    items: [
                      { key: "json", label: "导出 JSON" },
                      { key: "csv", label: "导出 CSV" },
                    ],
                    onClick: ({ key }) => download(b, key as BankExportFormat),
                  }}
                >
                  <Button type="link" size="small">导出</Button>
                </Dropdown>
                <Button type="link" size="small" onClick={() => { setReport(null); setImportBank(b); }}>导入</Button>
                {!b.is_default && (
                  <Popconfirm title={`删除「${b.name}」？题目移入默认题库。`}
                    okText="删除" cancelText="取消" onConfirm={() => remove(b)}>
                    <Button type="link" size="small" danger>删除</Button>
                  </Popconfirm>
                )}
              </>
            ),
          },
        ]}
      />

      <Modal open={edit.open} title={edit.bank ? "编辑题库" : "新建题库"}
        onCancel={() => setEdit({ open: false, bank: null })}
        onOk={save} confirmLoading={busy} okText="保存" cancelText="取消" destroyOnClose>
        <Form form={form} layout="vertical" requiredMark={false} style={{ marginTop: 16 }}>
          <Form.Item name="name" label="题库名称"
            rules={[{ required: true, message: "请输入题库名称" }]}>
            <Input placeholder="如：Java 面试" />
          </Form.Item>
          <Form.Item name="description" label="备注">
            <Input.TextArea rows={3} placeholder="这个题库是做什么的（可选）" showCount maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal open={importBank !== null} title={`导入题目到「${importBank?.name ?? ""}」`}
        footer={null} onCancel={closeImport} destroyOnClose>
        <p style={{ color: "#777268", marginBottom: 16 }}>
          支持 JSON、CSV、TSV。只导入题目，不包含学习进度；不能直接复习的题会保留在待确认。
        </p>
        <Upload.Dragger
          accept=".json,.csv,.tsv,.txt"
          showUploadList={false}
          disabled={importing}
          customRequest={async ({ file, onSuccess, onError }) => {
            try {
              const result = await importFile(file as File);
              onSuccess?.(result);
            } catch (error) {
              message.error(error instanceof Error ? error.message : "导入失败");
              onError?.(error as Error);
            }
          }}
        >
          <p style={{ padding: "8px 0" }}>{importing ? "正在导入…" : "点击或拖拽文件到此区域导入"}</p>
          <p style={{ color: "#999" }}>同一题库内按题面和答案去重，可安全重试</p>
        </Upload.Dragger>
        {report && (
          <Card size="small" title="导入报告" style={{ marginTop: 16 }}>
            <div role="status">
              <p>导入完成：新增 {report.created} 道，跳过重复 {report.duplicates} 道。</p>
              <p>状态：{Object.entries(report.by_status).map(([status, count]) => `${status} ${count} 道`).join("；") || "无新增"}</p>
              {report.invalid.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <strong>未导入的行</strong>
                  <ul>{report.invalid.map((item) => <li key={`${item.line}-${item.reason}`}>第 {item.line} 行：{item.reason}</li>)}</ul>
                </div>
              )}
              {report.needs_review.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <strong>已保留为待确认</strong>
                  <ul>{report.needs_review.map((item) => (
                    <li key={`${item.line}-${item.stem}`}>第 {item.line} 行「{item.stem}」：{item.reasons.join("；")}</li>
                  ))}</ul>
                </div>
              )}
              {report.truncated && <p style={{ color: "#a43f3f" }}>问题行较多，仅展示前 100 条。</p>}
              <Button type="primary" onClick={closeImport} style={{ marginTop: 8 }}>完成</Button>
            </div>
          </Card>
        )}
      </Modal>
    </Card>
  );
}
