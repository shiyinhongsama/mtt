import {
  App as AntdApp, Button, Card, Input, Popconfirm, Select, Space, Table, Tag, Typography, Popover,
} from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { Question, QuestionStatus } from "../types";
import { QTYPE_LABELS, STATUS_LABELS } from "../types";
import QuestionModal, { useBankOptions, useCategoryOptions } from "../components/QuestionModal";
import Md from "../components/Md";

/** 行内摘要：去掉 Markdown 语法，代码块用 [代码] 占位 */
function plain(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " [代码] ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_#>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const STATUS_COLORS: Record<QuestionStatus, string> = {
  active: "green",
  pending: "gold",
  flagged: "red",
  suspended: "default",
};

interface Query {
  status: string;      // "" = 全部
  bank_id?: number;
  qtype?: QTypeFilter;
  category_id?: number;
  difficulty?: number;
  q?: string;
  page: number;
  pageSize: number;
}
type QTypeFilter = keyof typeof QTYPE_LABELS | undefined;

interface ListResponse {
  total: number;
  items: Question[];
}

/** 题目管理：多条件组合查询 + 服务端分页 */
export default function QuestionsPage(
  { initialStatus = "active", initialBank = null }: { initialStatus?: string; initialBank?: number | null },
) {
  const { message } = AntdApp.useApp();
  const [query, setQuery] = useState<Query>({
    status: initialStatus, bank_id: initialBank ?? undefined,
    page: 1, pageSize: 15,
  });
  const [data, setData] = useState<ListResponse>({ total: 0, items: [] });
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ open: boolean; question: Question | null }>({
    open: false, question: null,
  });
  const categoryOptions = useCategoryOptions();
  const catName = useMemo(
    () => new Map(categoryOptions.map((o) => [o.value, o.label.trim()])),
    [categoryOptions],
  );
  const bankOptions = useBankOptions();
  const bankName = useMemo(
    () => new Map(bankOptions.map((o) => [o.value, o.label.replace("（默认）", "")])),
    [bankOptions],
  );

  const load = useCallback(async (q: Query) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.status) params.set("status", q.status);
      if (q.bank_id) params.set("bank_id", String(q.bank_id));
      if (q.qtype) params.set("qtype", q.qtype);
      if (q.category_id) params.set("category_id", String(q.category_id));
      if (q.difficulty) params.set("difficulty", String(q.difficulty));
      if (q.q?.trim()) params.set("q", q.q.trim());
      params.set("page", String(q.page));
      params.set("page_size", String(q.pageSize));
      setData(await api<ListResponse>(`/questions?${params}`));
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    load(query).catch(() => undefined);
  }, [query, load]);

  const patch = (p: Partial<Query>) => setQuery((prev) => ({ ...prev, ...p, page: 1 }));
  const reset = () => setQuery({
    status: "", bank_id: undefined, qtype: undefined, category_id: undefined,
    difficulty: undefined, q: "", page: 1, pageSize: query.pageSize,
  });

  const act = async (q: Question, action: "confirm" | "flag" | "suspend" | "reactivate" | "delete") => {
    try {
      if (action === "delete") await api(`/questions/${q.id}`, { method: "DELETE" });
      else await api(`/questions/${q.id}/${action}`, { method: "POST" });
      message.success("已操作");
      await load(query);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "操作失败");
    }
  };

  const actions = (q: Question) => {
    const btns = [
      <Button key="edit" type="link" size="small"
        onClick={() => setModal({ open: true, question: q })}>编辑</Button>,
    ];
    if (q.status === "pending") {
      btns.push(<Button key="confirm" type="link" size="small"
        onClick={() => act(q, "confirm")}>确认入队</Button>);
    }
    if (q.status === "active") {
      btns.push(<Button key="flag" type="link" size="small"
        onClick={() => act(q, "flag")}>标记问题</Button>);
      btns.push(<Button key="suspend" type="link" size="small"
        onClick={() => act(q, "suspend")}>暂停</Button>);
    }
    if (q.status === "flagged" || q.status === "suspended") {
      btns.push(<Button key="reactivate" type="link" size="small"
        onClick={() => act(q, "reactivate")}>恢复</Button>);
    }
    btns.push(
      <Popconfirm key="delete" title="确定删除这道题？" okText="删除" cancelText="取消"
        onConfirm={() => act(q, "delete")}>
        <Button type="link" size="small" danger>删除</Button>
      </Popconfirm>,
    );
    return <Space size={0}>{btns}</Space>;
  };

  return (
    <Card>
      <Space style={{ marginBottom: 16 }} wrap>
        <Select
          value={query.status}
          onChange={(v) => patch({ status: v })}
          style={{ width: 120 }}
          options={[
            { value: "", label: "全部状态" },
            ...(Object.keys(STATUS_LABELS) as QuestionStatus[]).map((s) => ({
              value: s, label: STATUS_LABELS[s],
            })),
          ]}
        />
        <Select
          value={query.bank_id}
          onChange={(v) => patch({ bank_id: v })}
          style={{ width: 150 }}
          placeholder="全部题库"
          allowClear
          options={bankOptions}
        />
        <Select
          value={query.qtype}
          onChange={(v) => patch({ qtype: v })}
          style={{ width: 120 }}
          placeholder="全部题型"
          allowClear
          options={(Object.keys(QTYPE_LABELS) as (keyof typeof QTYPE_LABELS)[]).map((k) => ({
            value: k, label: QTYPE_LABELS[k],
          }))}
        />
        <Select
          value={query.category_id}
          onChange={(v) => patch({ category_id: v })}
          style={{ width: 160 }}
          placeholder="全部分类"
          allowClear
          options={categoryOptions}
        />
        <Select
          value={query.difficulty}
          onChange={(v) => patch({ difficulty: v })}
          style={{ width: 100 }}
          placeholder="难度"
          allowClear
          options={[1, 2, 3, 4, 5].map((d) => ({ value: d, label: `难度 ${d}` }))}
        />
        <Input.Search
          defaultValue={query.q}
          placeholder="题面 / 答案 / 标签"
          allowClear
          style={{ width: 220 }}
          onSearch={(v) => patch({ q: v })}
        />
        <Button onClick={reset}>重置</Button>
        <Button type="primary" onClick={() => setModal({ open: true, question: null })}>
          新建题目
        </Button>
      </Space>

      <Table<Question>
        rowKey="id"
        size="middle"
        scroll={{ x: true }}
        loading={loading}
        dataSource={data.items}
        pagination={{
          current: query.page, pageSize: query.pageSize, total: data.total,
          showTotal: (t) => `共 ${t} 道`, showSizeChanger: true,
          onChange: (page, pageSize) => setQuery((prev) => ({ ...prev, page, pageSize })),
        }}
        columns={[
          { title: "#", dataIndex: "id", width: 64 },
          {
            title: "题面", dataIndex: "stem", width: 320,
            render: (stem: string) => (
              <Popover
                placement="topLeft"
                mouseEnterDelay={0.3}
                content={(
                  <div style={{ maxWidth: 520, maxHeight: 380, overflowY: "auto" }}>
                    <Md>{stem}</Md>
                  </div>
                )}
              >
                <Typography.Text ellipsis={{ tooltip: false }}
                  style={{ maxWidth: 300, display: "block", cursor: "default", color: "#1A1815" }}>
                  {plain(stem) || "（空）"}
                </Typography.Text>
              </Popover>
            ),
          },
          { title: "题库", dataIndex: "bank_id", width: 120,
            render: (id: number | null) => (id ? bankName.get(id) ?? id : "—") },
          { title: "题型", dataIndex: "qtype", width: 90,
            render: (t) => QTYPE_LABELS[t as keyof typeof QTYPE_LABELS] },
          { title: "分类", dataIndex: "category_id", width: 130,
            render: (id: number | null) => (id ? catName.get(id) ?? id : "—") },
          { title: "难度", dataIndex: "difficulty", width: 64 },
          { title: "标签", dataIndex: "tags", width: 150, ellipsis: true,
            render: (tags: string[]) => tags.map((t) => <Tag key={t}>{t}</Tag>) },
          { title: "状态", dataIndex: "status", width: 90,
            render: (s: QuestionStatus) => (
              <Tag color={STATUS_COLORS[s]}>{STATUS_LABELS[s]}</Tag>
            ) },
          { title: "操作", key: "actions", width: 250, render: (_, q) => actions(q) },
        ]}
      />

      <QuestionModal
        open={modal.open}
        question={modal.question}
        onClose={() => setModal({ open: false, question: null })}
        onSaved={() => { setModal({ open: false, question: null }); load(query).catch(() => undefined); }}
      />
    </Card>
  );
}
