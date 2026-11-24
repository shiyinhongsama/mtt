import { App as AntdApp, Collapse, Form, Input, InputNumber, Modal, Select } from "antd";
import MDEditor from "@uiw/react-md-editor";
import "@uiw/react-md-editor/markdown-editor.css";
import { useEffect, useState } from "react";
import { api } from "../api";
import type { Category, QType, Question, QuestionBank, QuestionCreate } from "../types";
import { QTYPE_LABELS } from "../types";
import Md from "./Md";

/** 分类下拉：树形拍平成缩进选项 */
export function useCategoryOptions() {
  const [options, setOptions] = useState<{ value: number; label: string }[]>([]);
  useEffect(() => {
    api<Category[]>("/questions/categories/tree")
      .then((tree) => {
        const out: { value: number; label: string }[] = [];
        const walk = (nodes: Category[], depth: number) =>
          nodes.forEach((n) => {
            out.push({ value: n.id, label: `${"　".repeat(depth)}${n.name}` });
            walk(n.children, depth + 1);
          });
        walk(tree, 0);
        setOptions(out);
      })
      .catch(() => undefined);
  }, []);
  return options;
}

/** 题库下拉 */
export function useBankOptions() {
  const [options, setOptions] = useState<{ value: number; label: string }[]>([]);
  useEffect(() => {
    api<QuestionBank[]>("/questions/banks")
      .then((banks) => setOptions(banks.map((b) => ({
        value: b.id, label: b.is_default ? `${b.name}（默认）` : b.name,
      }))))
      .catch(() => undefined);
  }, []);
  return options;
}

/** 包装组件：Form.Item 的 value/onChange 传给 MDEditor（不能直接包 div） */
function MdField({ value, onChange, height, placeholder }: {
  value?: string;
  onChange?: (v?: string) => void;
  height: number;
  placeholder?: string;
}) {
  return (
    <div data-color-mode="light">
      <MDEditor value={value ?? ""} onChange={onChange} height={height} placeholder={placeholder} />
    </div>
  );
}

interface Props {
  open: boolean;
  /** null = 新建 */
  question: Question | null;
  onClose: () => void;
  onSaved: () => void;
}

/** 题目编辑/新建弹窗（新建默认进预览区） */
export default function QuestionModal({ open, question, onClose, onSaved }: Props) {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  const categoryOptions = useCategoryOptions();
  const bankOptions = useBankOptions();
  const qtype: QType = Form.useWatch("qtype", form) ?? "choice";
  const watchStem: string = Form.useWatch("stem", form) ?? "";
  const watchAnswer: string = Form.useWatch("answer", form) ?? "";
  const watchExplain: string = Form.useWatch("explanation", form) ?? "";

  useEffect(() => {
    if (!open) return;
    if (question) {
      form.setFieldsValue({
        stem: question.stem,
        qtype: question.qtype,
        options: question.options.join("\n"),
        answer: question.answer,
        explanation: question.explanation,
        source: question.source,
        difficulty: question.difficulty,
        tags: question.tags.join(", "),
        category_id: question.category_id,
        bank_id: question.bank_id,
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ qtype: "choice", difficulty: 3 });
    }
  }, [open, question, form]);

  const save = async () => {
    const v = await form.validateFields();
    const body: QuestionCreate = {
      stem: v.stem.trim(),
      answer: v.answer.trim(),
      qtype: v.qtype,
      options: v.qtype === "choice"
        ? String(v.options ?? "").split("\n").map((s: string) => s.trim()).filter(Boolean)
        : [],
      explanation: (v.explanation ?? "").trim(),
      source: (v.source ?? "").trim(),
      tags: String(v.tags ?? "").split(/[,，]/).map((s: string) => s.trim()).filter(Boolean),
      difficulty: v.difficulty ?? 3,
      category_id: v.category_id ?? null,
      bank_id: v.bank_id ?? null,
    };
    setBusy(true);
    try {
      if (question) {
        await api(`/questions/${question.id}`, { method: "PATCH", body });
        message.success("已保存");
      } else {
        await api("/questions", { method: "POST", body });
        message.success("已存入预览区");
      }
      onSaved();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={question ? `编辑题目 #${question.id}` : "新建题目"}
      onCancel={onClose}
      onOk={save}
      confirmLoading={busy}
      okText="保存"
      cancelText="取消"
      width={760}
      style={{ maxWidth: "calc(100vw - 24px)" }}
      destroyOnClose
    >
      <Form form={form} layout="vertical" requiredMark={false} style={{ marginTop: 16 }}>
        <Form.Item name="qtype" label="题型" rules={[{ required: true }]}>
          <Select options={(Object.keys(QTYPE_LABELS) as QType[]).map((k) => ({
            value: k, label: QTYPE_LABELS[k],
          }))} />
        </Form.Item>
        <Form.Item name="stem" label="题面"
          rules={[{ required: true, message: "题面不能为空" }, { max: 5000 }]}>
          <MdField height={220} placeholder="一道题只问一件事（支持 Markdown）" />
        </Form.Item>
        {qtype === "choice" && (
          <Form.Item name="options" label="选项（每行一个）"
            rules={[{ required: true, message: "选择题需要选项" }]}>
            <Input.TextArea rows={4} placeholder={"选项 A\n选项 B\n选项 C\n选项 D"} />
          </Form.Item>
        )}
        <Form.Item name="answer" label="答案"
          rules={[{ required: true, message: "答案不能为空" }]}>
          <Input placeholder={qtype === "judge" ? "对 / 错" : "标准答案"} />
        </Form.Item>
        <Form.Item name="explanation" label="讲解（支持 Markdown）">
          <MdField height={140} />
        </Form.Item>
        <Form.Item name="source" label="出处">
          <Input placeholder="笔记/文档位置" />
        </Form.Item>
        <Form.Item name="category_id" label="分类">
          <Select allowClear options={categoryOptions} placeholder="未分类" />
        </Form.Item>
        <Form.Item name="bank_id" label="题库" tooltip="不选则归入默认题库">
          <Select allowClear options={bankOptions} placeholder="默认题库" />
        </Form.Item>
        <Form.Item name="tags" label="标签（逗号分隔）">
          <Input />
        </Form.Item>
        <Form.Item name="difficulty" label="难度（1-5）">
          <InputNumber min={1} max={5} style={{ width: 120 }} />
        </Form.Item>
      </Form>

      <Collapse ghost items={[{
        key: "preview",
        label: "预览（Markdown 渲染效果）",
        children: (
          <div style={{ border: "1px solid #CFC9BA", padding: "12px 16px", background: "#FBF9F4" }}>
            <div style={{ fontSize: 12, color: "#777268", marginBottom: 6 }}>题面</div>
            <Md>{watchStem || "（空）"}</Md>
            <div style={{ fontSize: 12, color: "#777268", margin: "10px 0 6px" }}>答案</div>
            <Md>{watchAnswer || "（空）"}</Md>
            {watchExplain && (
              <>
                <div style={{ fontSize: 12, color: "#777268", margin: "10px 0 6px" }}>解析</div>
                <Md>{watchExplain}</Md>
              </>
            )}
          </div>
        ),
      }]} />
    </Modal>
  );
}
