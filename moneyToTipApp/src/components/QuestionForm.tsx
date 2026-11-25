import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Bank, QuestionCreate } from "../api/types";
import Button from "./ui/Button";
import CategorySelect from "./CategorySelect";

export function QuestionFields({ value, onChange }: {
  value: QuestionCreate;
  onChange: (patch: Partial<QuestionCreate>) => void;
}) {
  return (
    <>
      <div className="field"><label htmlFor="question-type">题型</label><select id="question-type" value={value.qtype} onChange={(event) => onChange({ qtype: event.target.value as QuestionCreate["qtype"] })}><option value="choice">选择</option><option value="blank">填空</option><option value="judge">判断</option><option value="qa">问答</option><option value="scenario">场景设计</option></select></div>
      <div className="field"><label htmlFor="question-stem">题面</label><textarea id="question-stem" value={value.stem} placeholder="一道题只问一件事" onChange={(event) => onChange({ stem: event.target.value })} /></div>
      {value.qtype === "choice" && <div className="field"><label htmlFor="question-options">选项（每行一个；正确项填在答案里）</label><textarea id="question-options" value={value.options.join("\n")} rows={3} onChange={(event) => onChange({ options: event.target.value.split("\n") })} /></div>}
      <div className="field"><label htmlFor="question-answer">答案</label><input id="question-answer" value={value.answer} onChange={(event) => onChange({ answer: event.target.value })} /></div>
      <div className="field"><label htmlFor="question-explanation">一句话讲解（可选）</label><textarea id="question-explanation" value={value.explanation} onChange={(event) => onChange({ explanation: event.target.value })} /></div>
      <div className="field-row">
        <div className="field"><label htmlFor="question-source">出处</label><input id="question-source" value={value.source} placeholder="笔记/文档位置" onChange={(event) => onChange({ source: event.target.value })} /></div>
        <div className="field"><label htmlFor="question-difficulty">难度 1-5</label><input id="question-difficulty" type="number" min={1} max={5} value={value.difficulty} onChange={(event) => onChange({ difficulty: Number(event.target.value) })} /></div>
      </div>
      <div className="field"><label htmlFor="question-tags">标签（逗号分隔，可选）</label><input id="question-tags" value={value.tags.join("，")} onChange={(event) => onChange({ tags: event.target.value.split(/[,，]/) })} /></div>
    </>
  );
}

export default function QuestionForm() {
  const [value, setValue] = useState<QuestionCreate>({ qtype: "choice", stem: "", options: [], answer: "", explanation: "", source: "", tags: [], difficulty: 3, category_id: null, bank_id: null });
  const [banks, setBanks] = useState<Bank[]>([]);
  const [msg, setMsg] = useState<{ text: string; err: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { api<Bank[]>("/questions/banks").then(setBanks).catch(() => undefined); }, []);
  const update = (patch: Partial<QuestionCreate>) => setValue((current) => ({ ...current, ...patch }));

  const submit = async () => {
    if (!value.stem.trim() || !value.answer.trim()) {
      setMsg({ text: "题面和答案不能为空", err: true });
      return;
    }
    setSaving(true);
    try {
      const body = { ...value, stem: value.stem.trim(), answer: value.answer.trim(),
        options: value.options.map((item) => item.trim()).filter(Boolean),
        tags: value.tags.map((item) => item.trim()).filter(Boolean) };
      await api("/questions", { method: "POST", body });
      setMsg({ text: "已存入题库待确认，确认后进入复习队列。", err: false });
      setValue({ qtype: value.qtype, stem: "", options: [], answer: "", explanation: "", source: "", tags: [], difficulty: 3, category_id: null, bank_id: null });
    } catch (error) {
      setMsg({ text: error instanceof Error ? error.message : "出错了", err: true });
    } finally { setSaving(false); }
  };

  return (
    <>
      <QuestionFields value={value} onChange={update} />
      <div className="field"><label>分类（可选）</label><CategorySelect value={value.category_id ?? null} onChange={(category_id) => update({ category_id })} /></div>
      <div className="field"><label>题库（不选则归默认题库）</label><select value={value.bank_id ?? ""} onChange={(event) => update({ bank_id: event.target.value ? Number(event.target.value) : null })}><option value="">默认题库</option>{banks.map((bank) => <option key={bank.id} value={bank.id}>{bank.name}</option>)}</select></div>
      <Button block loading={saving} onClick={submit}>存入待确认</Button>
      {msg && <div className={`form-msg${msg.err ? " err" : ""}`} role={msg.err ? "alert" : "status"}>{msg.text}</div>}
    </>
  );
}
