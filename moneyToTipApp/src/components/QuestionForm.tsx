import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Bank, QuestionCreate } from "../api/types";
import CategorySelect from "./CategorySelect";

/** 手动加题表单（R-corpus-05）：新题默认进预览区 */
export default function QuestionForm() {
  const [qtype, setQtype] = useState<QuestionCreate["qtype"]>("choice");
  const [stem, setStem] = useState("");
  const [options, setOptions] = useState("");
  const [answer, setAnswer] = useState("");
  const [explanation, setExplanation] = useState("");
  const [source, setSource] = useState("");
  const [difficulty, setDifficulty] = useState(3);
  const [tags, setTags] = useState("");
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [bankId, setBankId] = useState<number | null>(null);
  const [banks, setBanks] = useState<Bank[]>([]);

  useEffect(() => {
    api<Bank[]>("/questions/banks").then(setBanks).catch(() => undefined);
  }, []);
  const [msg, setMsg] = useState<{ text: string; err: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!stem.trim() || !answer.trim()) {
      setMsg({ text: "题面和答案不能为空", err: true });
      return;
    }
    const body: QuestionCreate = {
      stem: stem.trim(),
      answer: answer.trim(),
      qtype,
      options:
        qtype === "choice"
          ? options.split("\n").map((s) => s.trim()).filter(Boolean)
          : [],
      explanation: explanation.trim(),
      source: source.trim(),
      difficulty: Number(difficulty) || 3,
      tags: tags.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
      category_id: categoryId,
      bank_id: bankId,
    };
    setSaving(true);
    try {
      await api("/questions", { method: "POST", body });
      setMsg({ text: "已存入预览区，到「预览区」确认后进入复习队列。", err: false });
      setStem(""); setOptions(""); setAnswer(""); setExplanation(""); setSource(""); setTags("");
      setCategoryId(null);
      setBankId(null);
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : "出错了", err: true });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="field">
        <label>题型</label>
        <select value={qtype} onChange={(e) => setQtype(e.target.value as QuestionCreate["qtype"])}>
          <option value="choice">选择</option>
          <option value="blank">填空</option>
          <option value="judge">判断</option>
        </select>
      </div>
      <div className="field">
        <label>题面</label>
        <textarea
          value={stem}
          placeholder="一道题只问一件事"
          onChange={(e) => setStem(e.target.value)}
        />
      </div>
      {qtype === "choice" && (
        <div className="field">
          <label>选项（每行一个；正确项填在答案里）</label>
          <textarea value={options} rows={3} onChange={(e) => setOptions(e.target.value)} />
        </div>
      )}
      <div className="field">
        <label>答案</label>
        <input value={answer} onChange={(e) => setAnswer(e.target.value)} />
      </div>
      <div className="field">
        <label>一句话讲解（可选）</label>
        <textarea value={explanation} onChange={(e) => setExplanation(e.target.value)} />
      </div>
      <div className="field-row">
        <div className="field">
          <label>出处（可选）</label>
          <input
            value={source}
            placeholder="笔记/文档位置"
            onChange={(e) => setSource(e.target.value)}
          />
        </div>
        <div className="field">
          <label>难度 1-5</label>
          <input
            type="number"
            min={1}
            max={5}
            value={difficulty}
            onChange={(e) => setDifficulty(Number(e.target.value))}
          />
        </div>
      </div>
      <div className="field">
        <label>标签（逗号分隔，可选）</label>
        <input value={tags} onChange={(e) => setTags(e.target.value)} />
      </div>
      <div className="field">
        <label>分类（可选）</label>
        <CategorySelect value={categoryId} onChange={setCategoryId} />
      </div>
      <div className="field">
        <label>题库（不选则归默认题库）</label>
        <select value={bankId ?? ""} onChange={(e) => setBankId(e.target.value ? Number(e.target.value) : null)}>
          <option value="">默认题库</option>
          {banks.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      </div>
      <button className="btn block" disabled={saving} onClick={submit}>
        存入预览区
      </button>
      {msg && <div className={`form-msg${msg.err ? " err" : ""}`}>{msg.text}</div>}
    </>
  );
}
