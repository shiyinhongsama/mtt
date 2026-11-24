import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import type { Bank, DueQuestion, Plan, ReviewSubmit } from "../api/types";
import AnswerArea from "../components/AnswerArea";
import CategorySelect from "../components/CategorySelect";
import FeedbackPanel from "../components/FeedbackPanel";
import ExplainPanel from "../components/ExplainPanel";
import QuestionCard from "../components/QuestionCard";
import { getActivePlanIds } from "./PlansPage";

interface Answered {
  question: DueQuestion;
  correct: boolean;
  given: string;
  submitted: boolean;
  /** 主观题（问答/场景设计）：无自动判定，四档自评 */
  subjective: boolean;
}

/** 参与今日的计划 + 剩余额度；exhausted = 到期题不足，今日视为完成 */
interface ActivePlan extends Plan {
  remaining: number;
  exhausted: boolean;
}

const CATEGORY_KEY = "mtt_review_category";
const BANK_KEY = "mtt_review_bank";
const RATINGS = { again: "again", hard: "hard", good: "good", easy: "easy" } as const;

function loadCategoryFilter(): number | null {
  const v = localStorage.getItem(CATEGORY_KEY);
  return v ? Number(v) : null;
}

function loadBankFilter(): number | null {
  const v = localStorage.getItem(BANK_KEY);
  return v ? Number(v) : null;
}

/**
 * 刷题主流程：打开即一道题（R-session-01）。
 * 计划分刷：顶部计划芯片可切换，每题扣所属计划额度，刷完自动跳到下一个未完成计划；
 * 全部计划完成（或到期题不足）→ 达成页，可跨计划加练（不限量）。
 */
export default function ReviewPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const catParam = searchParams.get("cat");
  const bankParam = searchParams.get("bank");
  const [queue, setQueue] = useState<DueQuestion[] | null>(null);
  const [current, setCurrent] = useState<DueQuestion | null>(null);
  const [answered, setAnswered] = useState<Answered | null>(null);
  const [categoryId, setCategoryId] = useState<number | null>(() =>
    catParam ? Number(catParam) : loadCategoryFilter());
  const [bankId, setBankId] = useState<number | null>(() =>
    bankParam ? Number(bankParam) : loadBankFilter());
  const [banks, setBanks] = useState<Bank[]>([]);
  const [askOpen, setAskOpen] = useState(false);

  // 计划状态
  const [plans, setPlans] = useState<ActivePlan[]>([]);
  const [currentPlanId, setCurrentPlanId] = useState<number | null>(null);
  const [totalRemaining, setTotalRemaining] = useState(0);
  const [extraMode, setExtraMode] = useState(false);
  const plansRef = useRef<ActivePlan[]>([]);
  const totalRef = useRef(0);
  const extraRef = useRef(false);
  const qPlanMap = useRef<Map<number, number>>(new Map()); // question_id → plan_id

  const loading = useRef(false);
  const shownAt = useRef(0);

  useEffect(() => {
    api<Bank[]>("/questions/banks").then(setBanks).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (catParam) setCategoryId(Number(catParam));
  }, [catParam]);
  useEffect(() => {
    if (bankParam) setBankId(Number(bankParam));
  }, [bankParam]);

  const fetchDue = useCallback(
    async (catId: number | null, bkId: number | null, limit: number) => {
      const params = new URLSearchParams({ limit: String(limit) });
      if (catId) params.set("category_id", String(catId));
      if (bkId) params.set("bank_id", String(bkId));
      return api<DueQuestion[]>(`/reviews/due?${params}`);
    },
    [],
  );

  const setSessionQueue = useCallback((due: DueQuestion[], planId: number | null) => {
    qPlanMap.current = new Map(due.map((q) => [q.id, planId ?? -1]));
    setQueue(due);
    setCurrent(due[0] ?? null);
    setAnswered(null);
    shownAt.current = Date.now();
  }, []);

  const syncPlans = useCallback((next: ActivePlan[]) => {
    plansRef.current = next;
    setPlans(next);
    const total = next.reduce((s, p) => s + p.remaining, 0);
    totalRef.current = total;
    setTotalRemaining(total);
  }, []);

  /** 切到某个计划的队列（额度内到期题） */
  const switchPlan = useCallback(
    async (plan: ActivePlan) => {
      if (loading.current) return;
      loading.current = true;
      setCurrentPlanId(plan.id);
      try {
        const due = await fetchDue(categoryId, plan.bank_id, Math.max(plan.remaining, 1));
        setSessionQueue(due, plan.id);
      } finally {
        loading.current = false;
      }
    },
    [categoryId, fetchDue, setSessionQueue],
  );

  /** 加练队列：跨全部计划合并（不限量，照常记录） */
  const buildExtraQueue = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const merged: DueQuestion[] = [];
      const seen = new Set<number>();
      const map = new Map<number, number>();
      for (const p of plansRef.current) {
        const due = await fetchDue(categoryId, p.bank_id, 50);
        for (const q of due) {
          if (seen.has(q.id)) continue;
          seen.add(q.id);
          merged.push(q);
          map.set(q.id, p.id);
        }
      }
      qPlanMap.current = map;
      setQueue(merged);
      setCurrent(merged[0] ?? null);
      setAnswered(null);
      shownAt.current = Date.now();
    } finally {
      loading.current = false;
    }
  }, [categoryId, fetchDue]);

  // 初始化/筛选变化
  useEffect(() => {
    if (loading.current) return;
    loading.current = true;
    (async () => {
      try {
        const ids = getActivePlanIds();
        if (ids.length === 0) {
          syncPlans([]);
          setCurrentPlanId(null);
          setExtraMode(false);
          extraRef.current = false;
          const due = await fetchDue(categoryId, bankId, 20);
          setSessionQueue(due, null);
          return;
        }
        const all = await api<Plan[]>("/plans");
        const actives: ActivePlan[] = ids
          .map((id) => all.find((p) => p.id === id))
          .filter((p): p is Plan => Boolean(p))
          .map((p) => ({ ...p, remaining: Math.max(0, p.daily_goal - p.today_done), exhausted: false }));
        syncPlans(actives);
        setExtraMode(false);
        extraRef.current = false;

        const first = actives.find((p) => p.remaining > 0) ?? null;
        setCurrentPlanId(first?.id ?? null);
        if (!first) {
          setSessionQueue([], null);
          return;
        }
        const due = await fetchDue(categoryId, first.bank_id, Math.max(first.remaining, 1));
        setSessionQueue(due, first.id);
      } catch {
        setQueue([]);
      } finally {
        loading.current = false;
      }
    })().catch(() => setQueue([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId, bankId]);

  const changeCategory = (id: number | null) => {
    setCategoryId(id);
    localStorage.setItem(CATEGORY_KEY, id ? String(id) : "");
    setSearchParams({
      ...(id ? { cat: String(id) } : {}),
      ...(bankId ? { bank: String(bankId) } : {}),
    });
  };

  const changeBank = (id: number | null) => {
    setBankId(id);
    localStorage.setItem(BANK_KEY, id ? String(id) : "");
    setSearchParams({
      ...(categoryId ? { cat: String(categoryId) } : {}),
      ...(id ? { bank: String(id) } : {}),
    });
  };

  /** 答一题：扣所属计划额度；到期不足的队列耗尽由 onNext 处理 */
  const decrement = useCallback((qid: number) => {
    const pid = qPlanMap.current.get(qid);
    if (pid === undefined || pid === -1) return;
    const next = plansRef.current.map((p) =>
      p.id === pid ? { ...p, remaining: Math.max(0, p.remaining - 1) } : p);
    syncPlans(next);
  }, [syncPlans]);

  const submit = useCallback(
    (q: DueQuestion, correct: boolean, rating: ReviewSubmit["rating"]) => {
      const payload: ReviewSubmit = {
        question_id: q.id,
        client_id: crypto.randomUUID(),
        correct,
        rating,
        duration_ms: shownAt.current ? Date.now() - shownAt.current : 0,
      };
      api("/reviews", { method: "POST", body: payload })
        .then(() => {
          window.dispatchEvent(new Event("mtt:review-submitted"));
          if (plansRef.current.length > 0 && !extraRef.current) decrement(q.id);
        })
        .catch(() => undefined);
    },
    [decrement],
  );

  const onAnswer = useCallback(
    (q: DueQuestion) => (correct: boolean, given: string) => {
      if (!correct) {
        submit(q, false, "again");
        setAnswered({ question: q, correct, given, submitted: true, subjective: false });
      } else {
        setAnswered({ question: q, correct, given, submitted: false, subjective: false });
      }
    },
    [submit],
  );

  /** 主观题：思考后查看答案，再四档自评 */
  const onReveal = useCallback(() => {
    if (!current) return;
    setAnswered({ question: current, correct: false, given: "", submitted: false, subjective: true });
  }, [current]);

  const onRate = useCallback(
    (rating: keyof typeof RATINGS) => {
      if (!answered) return;
      const correct = answered.subjective ? rating !== "again" : true;
      submit(answered.question, correct, RATINGS[rating]);
      setAnswered({ ...answered, correct, submitted: true });
    },
    [answered, submit],
  );

  const startExtra = useCallback(() => {
    setExtraMode(true);
    extraRef.current = true;
    buildExtraQueue().catch(() => undefined);
  }, [buildExtraQueue]);

  const onNext = useCallback(() => {
    const rest = queue?.slice(1) ?? [];
    setQueue(rest);
    setCurrent(rest[0] ?? null);
    setAnswered(null);
    shownAt.current = Date.now();
    if (rest.length > 0) return;

    const planList = plansRef.current;
    if (planList.length > 0 && extraRef.current) {
      buildExtraQueue().catch(() => undefined);
      return;
    }
    if (planList.length > 0) {
      // 当前计划额度未完但到期题不足 → 标记完成，自动切下一个
      const currentPlan = planList.find((p) => p.id === currentPlanId);
      let next = planList;
      if (currentPlan && currentPlan.remaining > 0 && !currentPlan.exhausted) {
        next = planList.map((p) =>
          p.id === currentPlan.id ? { ...p, remaining: 0, exhausted: true } : p);
        syncPlans(next);
      }
      const nxt = next.find((p) => p.remaining > 0);
      if (nxt) {
        setCurrentPlanId(nxt.id);
        fetchDue(categoryId, nxt.bank_id, Math.max(nxt.remaining, 1))
          .then((due) => setSessionQueue(due, nxt.id))
          .catch(() => undefined);
        return;
      }
      setQueue([]);
      setCurrent(null);
      return;
    }
    fetchDue(categoryId, bankId, 20)
      .then((due) => setSessionQueue(due, null))
      .catch(() => undefined);
  }, [queue, categoryId, bankId, currentPlanId, fetchDue, setSessionQueue, syncPlans, buildExtraQueue]);

  const planActive = plans.length > 0;
  const goalTotal = plans.reduce((s, p) => s + p.daily_goal, 0);
  const goalDone = goalTotal - totalRemaining;

  /** 计划芯片：切换计划、展示各自进度 */
  const planChips = planActive && (
    <div className="plan-chips">
      {plans.map((p) => {
        const done = Math.min(p.daily_goal - p.remaining, p.daily_goal);
        const finished = p.remaining === 0;
        return (
          <button
            key={p.id}
            className={`plan-chip${!extraMode && p.id === currentPlanId ? " active" : ""}${finished ? " done" : ""}`}
            onClick={() => !extraMode && !finished && switchPlan(p)}
            disabled={extraMode || finished}
            title={p.exhausted ? "到期题不足，今日已计入完成" : undefined}
          >
            <span className="plan-chip-name">{p.name}</span>
            <span className="plan-chip-num">{done}/{p.daily_goal}{finished ? " ✓" : ""}</span>
            <span className="plan-chip-bar">
              <span style={{ width: `${Math.round((done / p.daily_goal) * 100)}%` }} />
            </span>
          </button>
        );
      })}
      <span className="plan-chips-total">
        {extraMode ? "加练中 · 不限量" : `今日 ${goalDone}/${goalTotal}`}
      </span>
    </div>
  );

  // 达成页：全部计划额度用完或到期不足
  if (planActive && !extraMode && totalRemaining === 0) {
    return (
      <div>
        {planChips}
        <div className="empty">
          <span className="big">今日目标达成</span>
          {plans.map((p) => (
            <span key={p.id} style={{ display: "block" }}>
              「{p.name}」{Math.min(p.daily_goal - p.remaining, p.daily_goal)}/{p.daily_goal} 题
              {p.exhausted && <em style={{ fontStyle: "normal", fontSize: 13, color: "var(--muted)" }}>（到期题不足）</em>}
            </span>
          ))}
          明天再来，材料进得来，复习排得准。
          <div className="next-row" style={{ maxWidth: 320, margin: "20px auto 0" }}>
            <button className="btn ghost block" onClick={startExtra}>加练 · 不限量</button>
          </div>
        </div>
      </div>
    );
  }

  if (queue === null) {
    return <div className="empty">取题中……</div>;
  }

  if (!current) {
    return (
      <div>
        {planChips}
        <FilterRow categoryId={categoryId} bankId={bankId} banks={banks}
                   onChangeCategory={changeCategory} onChangeBank={changeBank}
                   bankLocked={planActive} />
        <div className="empty">
          <span className="big">{planActive && extraMode ? "加练完成" : "今日完成"}</span>
          {categoryId ? "这个分类没有到期的题。" : "已到期的题都刷完了。"}
          <br />
          明天再来，材料进得来，复习排得准。
          {planActive && !extraMode && (
            <div className="next-row" style={{ maxWidth: 320, margin: "18px auto 0" }}>
              <button className="btn ghost block" onClick={startExtra}>加练 · 不限量</button>
            </div>
          )}
        </div>
      </div>
    );
  }

  const activePlan = plans.find((p) => p.id === currentPlanId);

  return (
    <div>
      {planChips}
      <FilterRow categoryId={categoryId} bankId={planActive ? activePlan?.bank_id ?? null : bankId}
                 banks={banks}
                 onChangeCategory={changeCategory} onChangeBank={changeBank}
                 bankLocked={planActive} />
      <QuestionCard question={current} />
      {answered ? (
        <FeedbackPanel
          question={answered.question}
          correct={answered.correct}
          given={answered.given}
          submitted={answered.submitted}
          subjective={answered.subjective}
          onRate={onRate}
          onNext={onNext}
          onAsk={() => setAskOpen(true)}
        />
      ) : (
        <AnswerArea
          key={current.id}
          question={current}
          disabled={false}
          onAnswer={onAnswer(current)}
          onReveal={onReveal}
        />
      )}
      {askOpen && answered && (
        <ExplainPanel
          question={answered.question}
          given={answered.given}
          onClose={() => setAskOpen(false)}
          onNext={onNext}
        />
      )}
    </div>
  );
}

/** 范围筛选：不是前置门槛，只是队列开关（选中分类含全部后代） */
function FilterRow({
  categoryId,
  bankId,
  banks,
  onChangeCategory,
  onChangeBank,
  bankLocked = false,
}: {
  categoryId: number | null;
  bankId: number | null;
  banks: Bank[];
  onChangeCategory: (id: number | null) => void;
  onChangeBank: (id: number | null) => void;
  bankLocked?: boolean;
}) {
  return (
    <div className="filter-row">
      <label>题库</label>
      <select value={bankId ?? ""} disabled={bankLocked}
        title={bankLocked ? "题库由当前计划决定" : undefined}
        onChange={(e) => onChangeBank(e.target.value ? Number(e.target.value) : null)}>
        <option value="">{bankLocked ? "随计划" : "全部"}</option>
        {banks.map((b) => (
          <option key={b.id} value={b.id}>{b.name}</option>
        ))}
      </select>
      <label>分类</label>
      <CategorySelect value={categoryId} onChange={onChangeCategory} emptyLabel="全部" />
    </div>
  );
}
