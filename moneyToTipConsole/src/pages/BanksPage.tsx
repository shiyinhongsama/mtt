import { App as AntdApp, Button, Card, Form, Input, Modal, Popconfirm, Table, Tag } from "antd";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { QuestionBank } from "../types";

/** 题库管理：名称 + 备注，题目的一级容器 */
export default function BanksPage() {
  const { message } = AntdApp.useApp();
  const [banks, setBanks] = useState<QuestionBank[]>([]);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<{ open: boolean; bank: QuestionBank | null }>({
    open: false, bank: null,
  });
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);

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
            title: "操作", key: "actions", width: 180,
            render: (_, b) => (
              <>
                <Button type="link" size="small" onClick={() => {
                  form.setFieldsValue({ name: b.name, description: b.description });
                  setEdit({ open: true, bank: b });
                }}>编辑</Button>
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
    </Card>
  );
}
