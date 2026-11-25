import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { Bank, Plan } from "../api/types";
import Button from "../components/ui/Button";
import { EmptyState, ErrorState, Skeleton } from "../components/ui/Feedback";

export default function PlansPage() {
  const queryClient = useQueryClient();
  const plans = useQuery({ queryKey: ["plans"], queryFn: () => api<Plan[]>("/plans"), retry: false });
  const banks = useQuery({ queryKey: ["banks"], queryFn: () => api<Bank[]>("/questions/banks"), retry: false });
  const active = useQuery({ queryKey: ["plans", "active"], queryFn: () => api<{ plan_ids: number[] }>("/plans/active"), retry: false });
  const [name, setName] = useState("");
  const [bankId, setBankId] = useState<number | null>(null);
  const [goal, setGoal] = useState(10);
  const [msg, setMsg] = useState<{ text: string; err: boolean } | null>(null);
  const activeIds = active.data?.plan_ids ?? [];

  const saveActive = useMutation({
    mutationFn: (planIds: number[]) => api<{ plan_ids: number[] }>("/plans/active", {
      method: "PUT", body: { plan_ids: planIds },
    }),
    onSuccess: (result) => queryClient.setQueryData(["plans", "active"], result),
    onError: (error) => setMsg({ text: error.message, err: true }),
  });

  const toggle = (id: number) => {
    const next = activeIds.includes(id) ? activeIds.filter((item) => item !== id) : [...activeIds, id];
    saveActive.mutate(next);
  };

  const create = async () => {
    if (!name.trim()) {
      setMsg({ text: "给计划起个名字", err: true });
      return;
    }
    try {
      const plan = await api<Plan>("/plans", {
        method: "POST", body: { name: name.trim(), bank_id: bankId, daily_goal: Number(goal) || 10 },
      });
      await saveActive.mutateAsync([...activeIds, plan.id]);
      await queryClient.invalidateQueries({ queryKey: ["plans"], exact: true });
      setMsg({ text: `计划「${plan.name}」已创建，并加入今日`, err: false });
      setName("");
    } catch (error) {
      setMsg({ text: error instanceof Error ? error.message : "创建失败", err: true });
    }
  };

  const remove = async (plan: Plan) => {
    if (!window.confirm(`删除计划「${plan.name}」？（不影响题目与进度）`)) return;
    try {
      await api(`/plans/${plan.id}`, { method: "DELETE" });
      if (activeIds.includes(plan.id)) await saveActive.mutateAsync(activeIds.filter((id) => id !== plan.id));
      await queryClient.invalidateQueries({ queryKey: ["plans"], exact: true });
    } catch (error) {
      setMsg({ text: error instanceof Error ? error.message : "删除失败", err: true });
    }
  };

  if (plans.isLoading || active.isLoading) return <Skeleton lines={5} />;
  if (plans.isError || active.isError) {
    const error = plans.error ?? active.error;
    return <ErrorState message={error?.message ?? "暂时无法加载"} onRetry={() => { plans.refetch(); active.refetch(); }} />;
  }
  if (!plans.data || !active.data) return null;
  const bankName = (id: number | null) => id ? banks.data?.find((bank) => bank.id === id)?.name ?? `#${id}` : "全部题库";

  return (
    <div>
      <div className="view-title">训练计划</div>
      <p className="plan-hint">计划选择会同步到服务端；今日进度只统计计划范围内的不同题目。</p>
      {plans.data.length === 0 ? <EmptyState title="还没有计划" description="设定每日目标，让复习更有节奏。" /> : plans.data.map((plan) => {
        const isCurrent = activeIds.includes(plan.id);
        const percentage = Math.min(100, Math.round(plan.today_done / plan.daily_goal * 100));
        return (
          <div className={`plan-item${isCurrent ? " current" : ""}`} key={plan.id}>
            <div className="plan-head">
              <span className="plan-name">{plan.name}{isCurrent && <span className="plan-badge">当前</span>}{plan.goal_met && <span className="plan-badge met">已达成</span>}</span>
              <span className="plan-scope">{bankName(plan.bank_id)}</span>
            </div>
            <div className="plan-progress"><div className="plan-progress-fill" style={{ width: `${percentage}%` }} /></div>
            <div className="plan-foot">
              <span>今日 {Math.min(plan.today_done, plan.daily_goal)}/{plan.daily_goal} 题</span>
              <span className="li-actions">
                <button disabled={saveActive.isPending} onClick={() => toggle(plan.id)}>{isCurrent ? "退出今日" : "加入今日"}</button>
                <button className="danger" onClick={() => remove(plan)}>删除</button>
              </span>
            </div>
          </div>
        );
      })}
      {activeIds.length > 0 && <div className="li-actions" style={{ margin: "14px 0" }}><button disabled={saveActive.isPending} onClick={() => saveActive.mutate([])}>不用计划（自由刷题）</button></div>}

      <div className="view-title" style={{ fontSize: 17, marginTop: 22 }}>新建计划</div>
      <div className="field"><label>计划名称</label><input value={name} placeholder="如：Java 面试每日十题" onChange={(event) => setName(event.target.value)} /></div>
      <div className="field"><label>题库</label><select value={bankId ?? ""} onChange={(event) => setBankId(event.target.value ? Number(event.target.value) : null)}><option value="">全部题库</option>{banks.data?.map((bank) => <option key={bank.id} value={bank.id}>{bank.name}</option>)}</select></div>
      <div className="field"><label>每日目标（题）</label><input type="number" min={1} max={200} value={goal} onChange={(event) => setGoal(Number(event.target.value))} /></div>
      <Button block loading={saveActive.isPending} onClick={create}>创建并加入今日</Button>
      {msg && <div className={`form-msg${msg.err ? " err" : ""}`} role={msg.err ? "alert" : "status"}>{msg.text}</div>}
    </div>
  );
}
