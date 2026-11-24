import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import type { Bank, Plan } from "../api/types";

const ACTIVE_PLANS_KEY = "mtt_active_plans";

export function getActivePlanIds(): number[] {
  try {
    const v = JSON.parse(localStorage.getItem(ACTIVE_PLANS_KEY) ?? "[]");
    return Array.isArray(v) ? v.map(Number) : [];
  } catch {
    return [];
  }
}

function setActivePlanIds(ids: number[]) {
  localStorage.setItem(ACTIVE_PLANS_KEY, JSON.stringify(ids));
}

/** 训练计划：多个计划，选一个「当前」驱动每日目标（R-session-09 每日 N 题） */
export default function PlansPage() {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [activeIds, setActiveIds] = useState<number[]>(getActivePlanIds);
  const [name, setName] = useState("");
  const [bankId, setBankId] = useState<number | null>(null);
  const [goal, setGoal] = useState(10);
  const [msg, setMsg] = useState<{ text: string; err: boolean } | null>(null);

  const load = useCallback(async () => {
    setPlans(await api<Plan[]>("/plans"));
  }, []);

  useEffect(() => {
    load().catch((e) => setMsg({ text: e.message, err: true }));
    api<Bank[]>("/questions/banks").then(setBanks).catch(() => undefined);
  }, [load]);

  const toggle = (id: number) => {
    const next = activeIds.includes(id)
      ? activeIds.filter((x) => x !== id)
      : [...activeIds, id];
    setActiveIds(next);
    setActivePlanIds(next);
  };

  const clearAll = () => {
    setActiveIds([]);
    setActivePlanIds([]);
  };

  const create = async () => {
    if (!name.trim()) {
      setMsg({ text: "给计划起个名字", err: true });
      return;
    }
    try {
      const plan = await api<Plan>("/plans", {
        method: "POST",
        body: { name: name.trim(), bank_id: bankId, daily_goal: Number(goal) || 10 },
      });
      setMsg({ text: `计划「${plan.name}」已创建，并加入今日`, err: false });
      setName("");
      toggle(plan.id);
      await load();
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : "创建失败", err: true });
    }
  };

  const remove = async (p: Plan) => {
    if (!window.confirm(`删除计划「${p.name}」？（不影响题目与进度）`)) return;
    try {
      await api(`/plans/${p.id}`, { method: "DELETE" });
      if (activeIds.includes(p.id)) toggle(p.id);
      await load();
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : "删除失败", err: true });
    }
  };

  const bankName = (id: number | null) =>
    id ? (banks.find((b) => b.id === id)?.name ?? `#${id}`) : "全部题库";

  return (
    <div>
      <div className="view-title">训练计划</div>
      <p className="plan-hint">
        选定计划后，刷题页只出「今日剩余目标」内的到期题；答满目标可继续加练。
      </p>

      {plans === null ? (
        <div className="empty">载入中……</div>
      ) : plans.length === 0 ? (
        <div className="empty" style={{ padding: "30px 0" }}>
          还没有计划，先创建一个吧。
        </div>
      ) : (
        plans.map((p) => {
          const done = p.today_done;
          const total = p.daily_goal;
          const pct = Math.min(100, Math.round((done / total) * 100));
          const isCurrent = activeIds.includes(p.id);
          return (
            <div className={`plan-item${isCurrent ? " current" : ""}`} key={p.id}>
              <div className="plan-head">
                <span className="plan-name">
                  {p.name}
                  {isCurrent && <span className="plan-badge">当前</span>}
                  {p.goal_met && <span className="plan-badge met">已达成</span>}
                </span>
                <span className="plan-scope">{bankName(p.bank_id)}</span>
              </div>
              <div className="plan-progress">
                <div className="plan-progress-fill" style={{ width: `${pct}%` }} />
              </div>
              <div className="plan-foot">
                <span>今日 {Math.min(done, total)}/{total} 题</span>
                <span className="li-actions">
                  <button className={isCurrent ? "" : "primary"} onClick={() => toggle(p.id)}>
                    {isCurrent ? "退出今日" : "加入今日"}
                  </button>
                  <button className="danger" onClick={() => remove(p)}>删除</button>
                </span>
              </div>
            </div>
          );
        })
      )}

      {activeIds.length > 0 && (
        <div className="li-actions" style={{ margin: "14px 0" }}>
          <button onClick={clearAll}>不用计划（自由刷题）</button>
        </div>
      )}

      <div className="view-title" style={{ fontSize: 17, marginTop: 22 }}>新建计划</div>
      <div className="field">
        <label>计划名称</label>
        <input value={name} placeholder="如：Java 面试每日十题" onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label>题库</label>
        <select value={bankId ?? ""} onChange={(e) => setBankId(e.target.value ? Number(e.target.value) : null)}>
          <option value="">全部题库</option>
          {banks.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>每日目标（题）</label>
        <input type="number" min={1} max={200} value={goal}
          onChange={(e) => setGoal(Number(e.target.value))} />
      </div>
      <button className="btn block" onClick={create}>创建并加入今日</button>
      {msg && <div className={`form-msg${msg.err ? " err" : ""}`}>{msg.text}</div>}
    </div>
  );
}
