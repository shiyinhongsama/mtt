import { useEffect, useState } from "react";
import { api, clearToken } from "../api/client";
import type { ApiTokenInfo, Plan, Stats } from "../api/types";

interface Me {
  id: number;
  username: string;
  role: string;
}

/** 我的：个人信息 + 今日概览 + 我的计划 + 我的令牌 + 退出登录 */
export default function MePage() {
  const [me, setMe] = useState<Me | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [tokens, setTokens] = useState<ApiTokenInfo[]>([]);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    api<Me>("/identity/me").then(setMe).catch(() => undefined);
    api<Stats>("/stats").then(setStats).catch(() => undefined);
    api<Plan[]>("/plans").then(setPlans).catch(() => undefined);
    loadTokens();
  }, []);

  const loadTokens = () => {
    api<ApiTokenInfo[]>("/identity/tokens").then(setTokens).catch(() => undefined);
  };

  const revoke = async (t: ApiTokenInfo) => {
    if (!window.confirm(`吊销令牌 ${t.masked}？该设备将立即退出。`)) return;
    try {
      await api(`/identity/tokens/${t.id}/revoke`, { method: "POST" });
      setMsg("已吊销");
      loadTokens();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "吊销失败");
    }
  };

  const logout = () => {
    if (!window.confirm("退出登录？本机的 token 会清除（服务器上的令牌仍有效，可在这里吊销）。", )) return;
    clearToken();
    window.location.hash = "#/login";
    window.location.reload();
  };

  const fmt = (v: string) => new Date(v).toLocaleString("zh-CN", { hour12: false });

  return (
    <div>
      <div className="view-title">我的</div>

      <div className="me-card">
        <div className="me-avatar">{me?.username?.slice(0, 1)?.toUpperCase() ?? "?"}</div>
        <div>
          <div className="me-name">{me?.username ?? "…"}</div>
          <div className="me-role">{me?.role === "admin" ? "管理员" : "普通用户"}</div>
        </div>
      </div>

      {stats && (
        <div className="me-stats">
          <div><b>{stats.reviewed_today}</b><span>今日已答</span></div>
          <div><b>{stats.due_today}</b><span>今日待复习</span></div>
          <div><b>{stats.mature_count}</b><span>已掌握</span></div>
          <div><b>{stats.active_questions}</b><span>在库题目</span></div>
        </div>
      )}

      <div className="me-section-title">我的计划</div>
      {plans.length === 0 ? (
        <div className="me-empty">还没有训练计划</div>
      ) : (
        plans.map((p) => (
          <a className="me-row" href="#/plans" key={p.id}>
            <span>{p.name}</span>
            <span className="me-row-right">
              今日 {Math.min(p.today_done, p.daily_goal)}/{p.daily_goal}
              {p.goal_met && <em className="me-tag">已达成</em>}
            </span>
          </a>
        ))
      )}

      <div className="me-section-title">我的令牌</div>
      {tokens.filter((t) => !t.revoked).length === 0 ? (
        <div className="me-empty">没有可用令牌，请联系管理员签发</div>
      ) : (
        tokens.map((t) => (
          <div className="me-row" key={t.id}>
            <span className="me-mono">{t.masked}</span>
            <span className="me-row-right me-sub">
              {t.last_used_at ? `最近 ${fmt(t.last_used_at)}` : "未使用"}
              {!t.revoked && (
                <button className="me-revoke" onClick={() => revoke(t)}>吊销</button>
              )}
            </span>
          </div>
        ))
      )}
      <p className="me-hint">多端登录各用一个令牌；设备丢失或泄露时在这里吊销。令牌由管理员在管理端签发。</p>

      {msg && <div className="form-msg">{msg}</div>}

      <button className="btn ghost block" style={{ marginTop: 20 }} onClick={logout}>
        退出登录
      </button>
      <p className="me-hint" style={{ textAlign: "center" }}>忙里偷题 · Small tips, big steps</p>
    </div>
  );
}
