import { Card, Col, Row, Space, Statistic, Table, Tooltip, Typography } from "antd";
import { useEffect, useState } from "react";
import { api } from "../api";
import type { Stats } from "../types";

/** 仪表盘：KPI + 待办预警 + 30 天热力图 + 分类掌握度 */
export default function DashboardPage({ goQuestions, goBank }: { goQuestions: (status: string) => void; goBank: (bankId: number) => void }) {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    api<Stats>("/stats").then(setStats).catch(() => undefined);
  }, []);

  if (!stats) return <Card loading />;
  const sc = stats.status_counts;

  const kpi = [
    { title: "在库题目", value: stats.active_questions },
    { title: "今日待复习", value: stats.due_today },
    { title: "今日已答", value: stats.reviewed_today },
    { title: "成熟知识量", value: stats.mature_count, accent: true },
  ];

  return (
    <Space direction="vertical" size={16} style={{ display: "flex" }}>
      <Row gutter={16}>
        {kpi.map((k) => (
          <Col xs={12} lg={6} key={k.title}>
            <Card>
              <Statistic title={k.title} value={k.value}
                valueStyle={k.accent ? { color: "#C1442E", fontFamily: "'Noto Serif SC',serif" } : { fontFamily: "'Noto Serif SC',serif" }} />
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={16}>
        <Col xs={24} lg={8}>
          <Card title="待办" size="small">
            <Space direction="vertical" style={{ display: "flex" }}>
              <a onClick={() => goQuestions("pending")}>
                预览区待确认：<b>{sc.pending ?? 0}</b> 道
              </a>
              <a onClick={() => goQuestions("flagged")}>
                已标记待修复：<b>{sc.flagged ?? 0}</b> 道
              </a>
              <a onClick={() => goQuestions("suspended")}>
                已暂停：<b>{sc.suspended ?? 0}</b> 道
              </a>
            </Space>
          </Card>
        </Col>
        <Col xs={24} lg={16}>
          <Card title="近 30 天答题" size="small">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(15, 1fr)", gap: 5 }}>
              {stats.heatmap.map((d) => (
                <Tooltip key={d.date} title={`${d.date} · ${d.count} 题`}>
                  <div style={{
                    height: 18,
                    background: d.count === 0 ? "#EDE9DF"
                      : d.count <= 2 ? "#DFC4B4"
                      : d.count <= 5 ? "#D68D70" : "#C1442E",
                  }} />
                </Tooltip>
              ))}
            </div>
          </Card>
        </Col>
      </Row>

      <Card title="题库概览" size="small" style={{ marginBottom: 16 }}>
        <Table
          size="small"
          scroll={{ x: true }}
          rowKey="bank_id"
          dataSource={stats.by_bank.map((b) => ({ ...b, key: b.bank_id ?? -1 }))}
          pagination={false}
          columns={[
            { title: "题库", dataIndex: "name",
              render: (v: string, b) => <a onClick={() => b.bank_id && goBank(b.bank_id)}>{v}</a> },
            { title: "在库", dataIndex: "total", width: 90 },
            { title: "已掌握", dataIndex: "mature", width: 90,
              render: (v: number) => <Typography.Text style={{ color: "#3A7D44" }}>{v}</Typography.Text> },
            { title: "今日待复习", dataIndex: "due", width: 110,
              render: (v: number) => v > 0
                ? <Typography.Text style={{ color: "#C1442E" }}>{v}</Typography.Text> : v },
          ]}
        />
      </Card>

      <Card title="分类掌握" size="small">
        <Table
          size="small"
          scroll={{ x: true }}
          rowKey="category_id"
          dataSource={stats.by_category.map((c) => ({ ...c, key: c.category_id ?? -1 }))}
          pagination={false}
          columns={[
            { title: "分类", dataIndex: "name" },
            { title: "在库", dataIndex: "total", width: 90 },
            { title: "已掌握", dataIndex: "mature", width: 90,
              render: (v: number) => <Typography.Text style={{ color: "#3A7D44" }}>{v}</Typography.Text> },
            { title: "今日待复习", dataIndex: "due", width: 110,
              render: (v: number) => v > 0
                ? <Typography.Text style={{ color: "#C1442E" }}>{v}</Typography.Text> : v },
          ]}
        />
      </Card>
    </Space>
  );
}
