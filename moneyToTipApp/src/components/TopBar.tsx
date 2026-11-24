import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Stats } from "../api/types";

/** 顶栏：品牌 + 今日进度（调度信息只露这一行，更多默认折叠，见 §15.3） */
export default function TopBar() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<Stats>("/stats")
      .then((s) => !cancelled && setStats(s))
      .catch(() => undefined);
    const refresh = () => {
      api<Stats>("/stats").then((s) => !cancelled && setStats(s)).catch(() => undefined);
    };
    window.addEventListener("mtt:review-submitted", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("mtt:review-submitted", refresh);
    };
  }, []);

  return (
    <header id="topbar">
      <div className="brand">
        <span className="cn">忙里偷题</span>
        <span className="en">MONEY TO TIP</span>
      </div>
      <div className="today">
        {stats ? `今日已答 ${stats.reviewed_today} · 待复习 ${stats.due_today}` : ""}
      </div>
    </header>
  );
}
