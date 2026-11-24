import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Stats } from "../api/types";

/** 统计：北极星指标 + 30 天热力图（R-growth-03）+ 分类掌握度（R-growth-04 一键去刷） */
export default function StatsPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    api<Stats>("/stats")
      .then(setStats)
      .catch((e) => setErr(e instanceof Error ? e.message : "出错了"));
  }, []);

  if (err) return <div className="empty">{err}</div>;
  if (!stats) return <div className="empty">载入中……</div>;

  return (
    <div>
      <div className="view-title">统计</div>
      <div className="stat-grid">
        <div className="stat-card">
          <div className="num accent">{stats.mature_count}</div>
          <div className="lbl">已掌握（21 天以上没忘）</div>
        </div>
        <div className="stat-card">
          <div className="num">{stats.due_today}</div>
          <div className="lbl">今日待复习</div>
        </div>
        <div className="stat-card">
          <div className="num">{stats.reviewed_today}</div>
          <div className="lbl">今日已答</div>
        </div>
        <div className="stat-card">
          <div className="num">{stats.active_questions}</div>
          <div className="lbl">在库题目</div>
        </div>
      </div>

      <div className="view-title" style={{ marginTop: 26, fontSize: 17 }}>近 30 天</div>
      <div className="heatmap">
        {stats.heatmap.map((d) => (
          <div key={d.date}
            className={`hm-cell${d.count === 0 ? "" : d.count <= 2 ? " c1" : d.count <= 5 ? " c2" : " c3"}`}
            title={`${d.date} · ${d.count} 题`} />
        ))}
      </div>

      <div className="view-title" style={{ marginTop: 26, fontSize: 17 }}>分类掌握</div>
      {stats.by_category.length === 0 ? (
        <div className="empty" style={{ padding: "20px 0" }}>还没有分类数据。</div>
      ) : (
        stats.by_category.map((c) => (
          <div className="cat-stat" key={c.category_id ?? -1}>
            <div className="cat-stat-name">
              {c.name}
              {c.category_id !== null && (
                <a href={`#/review?cat=${c.category_id}`} className="go-review">去刷</a>
              )}
            </div>
            <div className="cat-stat-nums">
              <span>在库 {c.total}</span>
              <span className="ok">已掌握 {c.mature}</span>
              <span className={c.due > 0 ? "due" : ""}>今日待复习 {c.due}</span>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
