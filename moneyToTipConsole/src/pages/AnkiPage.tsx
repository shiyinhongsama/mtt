import { App as AntdApp, Card, Col, Descriptions, Input, Row, Statistic, Upload } from "antd";
import { InboxOutlined } from "@ant-design/icons";
import { useState } from "react";
import { getToken } from "../api";

interface ImportReport {
  bank: string;
  questions_created: number;
  duplicates_skipped: number;
  dropped_empty: number;
  media_refs_skipped: number;
  categories_created: number;
  progress: { mastered: number; learning: number; new: number };
  decks: string[];
}

/** Anki 互操作：导入 .apkg / TSV，查看导入报告（R-anki-01/02/04/05/06/09） */
export default function AnkiPage() {
  const { message } = AntdApp.useApp();
  const [bank, setBank] = useState("");
  const [report, setReport] = useState<ImportReport | null>(null);
  const [importing, setImporting] = useState(false);

  const doImport = async (file: File) => {
    setImporting(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const qs = bank.trim() ? `?bank=${encodeURIComponent(bank.trim())}` : "";
      const r = await fetch(`/api/v1/anki/import${qs}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken()}` },
        body: form,
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail ?? "导入失败");
      setReport(data);
      message.success(`已导入 ${data.questions_created} 道题`);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "导入失败");
    } finally {
      setImporting(false);
    }
  };

  return (
    <Row gutter={16}>
      <Col xs={24} lg={12}>
        <Card title="导入牌组" style={{ marginBottom: 16 }}>
          <p style={{ color: "#777268" }}>
            支持 Anki 导出的 <code>.apkg</code>（含 <code>anki21/anki21b</code>）与
            「Notes in Plain Text」<code>.tsv/.txt</code>。牌组层级 <code>::</code> 会保留为分类树；
            卡片转为问答题型（自评判定）；旧进度粗略迁移（间隔 &gt; 21 天 → 已掌握）。
          </p>
          <Input value={bank} onChange={(e) => setBank(e.target.value)}
            placeholder="题库名称（留空 = Anki：文件名）" style={{ marginBottom: 16 }} />
          <Upload.Dragger
            accept=".apkg,.tsv,.txt,.csv"
            showUploadList={false}
            disabled={importing}
            customRequest={({ file, onSuccess, onError }) => {
              doImport(file as File)
                .then(() => onSuccess?.({}))
                .catch((e) => onError?.(e));
            }}
          >
            <p className="ant-upload-drag-icon"><InboxOutlined /></p>
            <p className="ant-upload-text">点击或拖拽 Anki 文件到此区域导入</p>
            <p className="ant-upload-hint">重复导入自动去重，可安全重试</p>
          </Upload.Dragger>
        </Card>
      </Col>

      <Col xs={24} lg={12}>
        {report && (
          <Card title="导入报告" style={{ marginBottom: 16 }}>
            <Row gutter={16} style={{ marginBottom: 16 }}>
              <Col span={8}><Statistic title="新建题目" value={report.questions_created} /></Col>
              <Col span={8}><Statistic title="重复跳过" value={report.duplicates_skipped} /></Col>
              <Col span={8}><Statistic title="新建分类" value={report.categories_created} /></Col>
            </Row>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="导入题库">{report.bank}</Descriptions.Item>
              <Descriptions.Item label="牌组">
                {report.decks.map((d) => <div key={d}><code>{d}</code></div>)}
              </Descriptions.Item>
              <Descriptions.Item label="进度迁移">
                已掌握 {report.progress.mastered} ｜ 巩固中 {report.progress.learning} ｜ 新学 {report.progress.new}
              </Descriptions.Item>
              <Descriptions.Item label="丢弃">
                空题/无卡片 {report.dropped_empty}
                {report.media_refs_skipped > 0 && ` ｜ 含图卡片 ${report.media_refs_skipped}（图片暂未导入）`}
              </Descriptions.Item>
            </Descriptions>
          </Card>
        )}
        <Card title="导出回 Anki" size="small">
          <p style={{ color: "#777268" }}>
            导出 .apkg / TSV 正在实现（R-anki-07）。当前可先在「数据」页导出全量 JSON 备份。
          </p>
        </Card>
      </Col>
    </Row>
  );
}
