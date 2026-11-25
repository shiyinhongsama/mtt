import { useState } from "react";
import { api } from "../../api/client";
import type { Question, QuestionCreate } from "../../api/types";
import { QuestionFields } from "../../components/QuestionForm";
import Button from "../../components/ui/Button";
import Sheet from "../../components/ui/Sheet";
import styles from "./QuestionEditorSheet.module.css";

export default function QuestionEditorSheet({ question, onClose, onSaved }: {
  question: Question;
  onClose: () => void;
  onSaved: () => void;
}) {
  const initial: QuestionCreate = { stem: question.stem, answer: question.answer, qtype: question.qtype,
    options: question.options, explanation: question.explanation, source: question.source,
    tags: question.tags, difficulty: question.difficulty, category_id: question.category_id, bank_id: question.bank_id };
  const [draft, setDraft] = useState(initial);
  const [confirmClose, setConfirmClose] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const requestClose = () => dirty ? setConfirmClose(true) : onClose();

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await api(`/questions/${question.id}`, { method: "PATCH", body: { ...draft,
        options: draft.options.map((item) => item.trim()).filter(Boolean),
        tags: draft.tags.map((item) => item.trim()).filter(Boolean) } });
      onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
    } finally { setSaving(false); }
  };

  const suspend = async () => {
    setSaving(true);
    try {
      await api(`/questions/${question.id}/suspend`, { method: "POST" });
      onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "暂停失败"); }
    finally { setSaving(false); }
  };

  return (
    <Sheet title="编辑题目" onClose={requestClose}>
      <QuestionFields value={draft} onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))} />
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <div className={styles.actions}>
        {question.status !== "suspended" && <Button variant="ghost" disabled={saving} onClick={suspend}>暂停此题</Button>}
        <Button loading={saving} disabled={!dirty} onClick={save}>保存修改</Button>
      </div>
      {confirmClose && <div className={styles.confirmBackdrop}><section role="dialog" aria-modal="true" aria-labelledby="discard-title" className={styles.confirm}>
        <h2 id="discard-title">放弃未保存的修改？</h2><p>关闭后，本次编辑内容不会保留。</p>
        <div><Button variant="ghost" onClick={() => setConfirmClose(false)}>继续编辑</Button><Button variant="danger" onClick={onClose}>放弃修改</Button></div>
      </section></div>}
    </Sheet>
  );
}
