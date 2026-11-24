import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import type { Question } from "../api/types";

/** 预览区（R-generate-05）：新题过目，确认后才进复习队列；可丢弃 */
export default function PendingPage() {
  const [items, setItems] = useState<Question[] | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      setItems((await api<{ items: Question[] }>("/questions?status=pending")).items);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "出错了");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (id: number, action: "confirm" | "drop") => {
    try {
      if (action === "confirm") await api(`/questions/${id}/confirm`, { method: "POST" });
      else await api(`/questions/${id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "操作失败");
    }
  };

  if (items === null) return <div className="empty">载入中……</div>;
  if (err) return <div className="empty">{err}</div>;
  if (items.length === 0) {
    return (
      <div className="empty">
        预览区是空的。
        <br />
        新题先在这里过目，确认后才进复习队列。
      </div>
    );
  }

  return (
    <div>
      <div className="view-title">预览区</div>
      <div className="count-note">共 {items.length} 道待确认</div>
      {items.map((q) => (
        <div className="list-item" key={q.id}>
          <div className="li-stem">{q.stem}</div>
          <div className="li-ans">
            答案：{q.answer}
            {q.source && <span className="fb-source">　{q.source}</span>}
          </div>
          <div className="li-actions">
            <button className="primary" onClick={() => act(q.id, "confirm")}>确认入队</button>
            <button className="danger" onClick={() => act(q.id, "drop")}>丢弃</button>
          </div>
        </div>
      ))}
    </div>
  );
}
