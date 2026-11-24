import {
  App as AntdApp, Button, Card, Col, Input, Popconfirm, Row, Upload,
} from "antd";
import { useState } from "react";
import { api, getToken } from "../api";

/** 数据主权：导出 / 导入 / 备份 / 销毁（R-data-01~05） */
export default function DataPage() {
  const { message } = AntdApp.useApp();
  const [wipeText, setWipeText] = useState("");
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/v1/data/export", {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!r.ok) throw new Error("导出失败");
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `moneytotip-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      message.success("已导出：题目、复习进度、日志、分类");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "导出失败");
    } finally {
      setBusy(false);
    }
  };

  const backup = async () => {
    setBusy(true);
    try {
      const r = await api<{ backup: string }>("/data/backup", { method: "POST" });
      message.success(`已备份到：${r.backup}`);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "备份失败");
    } finally {
      setBusy(false);
    }
  };

  const wipe = async () => {
    try {
      await api("/data/wipe", { method: "DELETE", body: { confirm: wipeText } });
      message.success("已清空个人数据（账户保留）");
      setWipeText("");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "清空失败");
    }
  };

  return (
    <Row gutter={16}>
      <Col xs={24} lg={14}>
        <Card title="备份与导出" style={{ marginBottom: 16 }}>
          <p style={{ color: "#777268" }}>
            服务端每天自动备份一份（保留最近 30 份）。也可随时手动备份或导出全量 JSON，
            导出文件可在本页或新实例上再导入。
          </p>
          <Upload.Dragger
            accept=".json"
            showUploadList={false}
            customRequest={async ({ file, onSuccess, onError }) => {
              try {
                const payload = JSON.parse(await (file as File).text());
                const r = await api<{ questions: number; categories: number;
                                      states: number; review_logs: number }>(
                  "/data/import", { method: "POST", body: payload });
                message.success(
                  `导入完成：分类 ${r.categories}，题目 ${r.questions}，状态 ${r.states}，日志 ${r.review_logs}`);
                onSuccess?.(r);
              } catch (e) {
                message.error(e instanceof Error ? e.message : "导入失败");
                onError?.(e as Error);
              }
            }}
          >
            <p style={{ padding: "8px 0" }}>点击或拖拽导出文件到此区域导入</p>
            <p style={{ color: "#999" }}>重复导入自动去重，可安全重试</p>
          </Upload.Dragger>
          <Button type="primary" onClick={download} loading={busy} style={{ marginTop: 16, marginRight: 12 }}>
            导出全量 JSON
          </Button>
          <Button onClick={backup} loading={busy}>立即备份</Button>
        </Card>
      </Col>

      <Col xs={24} lg={10}>
        <Card title="危险区" style={{ borderColor: "#C1442E" }} styles={{ header: { color: "#C1442E" } }}>
          <p style={{ color: "#777268", marginBottom: 16 }}>
            清空你的全部个人数据（题目、分类、复习进度、日志）。账户保留，数据不可恢复。
          </p>
          <Input value={wipeText} onChange={(e) => setWipeText(e.target.value)}
            placeholder='输入"清空"以确认' style={{ marginBottom: 12 }} />
          <Popconfirm
            title="确定清空全部个人数据？"
            description="不可恢复，建议先导出或备份。"
            okText="清空"
            okButtonProps={{ danger: true }}
            cancelText="取消"
            onConfirm={wipe}
          >
            <Button danger disabled={wipeText !== "清空"}>清空我的数据</Button>
          </Popconfirm>
        </Card>
      </Col>
    </Row>
  );
}
