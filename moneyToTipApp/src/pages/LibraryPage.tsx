import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { Question } from "../api/types";
import { EmptyState, ErrorState, Skeleton } from "../components/ui/Feedback";
import BulkConfirmBar from "../features/library/BulkConfirmBar";
import QuestionEditorSheet from "../features/library/QuestionEditorSheet";
import QuestionList from "../features/library/QuestionList";
import styles from "./LibraryPage.module.css";

interface BulkResult { confirmed_ids: number[]; failures: { id: number; reason: string }[] }

export default function LibraryPage({ initialStatus = "" }: { initialStatus?: string }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(initialStatus);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<Question | null>(null);
  const [notice, setNotice] = useState("");
  const questions = useQuery({
    queryKey: ["questions", "library", search, status, page],
    queryFn: () => api<{ total: number; items: Question[] }>(`/questions?${new URLSearchParams({ status, q: search, page: String(page), page_size: "20" })}`),
    retry: false,
  });
  const bulk = useMutation({
    mutationFn: (ids: number[]) => api<BulkResult>("/questions/bulk-confirm", { method: "POST", body: { ids } }),
    onSuccess: (result) => {
      const summary = `${result.confirmed_ids.length} 道已确认${result.failures.length ? `，${result.failures.length} 道需要修正` : ""}`;
      setNotice(summary);
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ["questions"] });
    },
    onError: (error) => setNotice(error.message),
  });

  const toggle = (id: number) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <main className={styles.page}>
      <header className={styles.header}><div><p>CONTENT LIBRARY</p><h1>题库</h1></div><span>{questions.data?.total ?? "—"} 道</span></header>
      <div className={styles.toolbar}>
        <label className={styles.search}><span className="sr-only">搜索题目</span><input type="search" aria-label="搜索题目" placeholder="搜索题面、答案或标签" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></label>
        <label><span className="sr-only">状态</span><select aria-label="状态" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); setSelected(new Set()); }}><option value="">全部状态</option><option value="pending">待确认</option><option value="active">复习中</option><option value="flagged">需修正</option><option value="suspended">已暂停</option></select></label>
      </div>
      <p className={styles.hint}>待确认题目可批量检查入队；有学习历史的题请暂停而不是删除。</p>
      {notice && <div className={styles.notice} role="status">{notice}<button onClick={() => setNotice("")} aria-label="关闭提示">×</button></div>}
      {questions.isError ? <ErrorState message={questions.error.message} onRetry={() => questions.refetch()} /> : questions.isLoading || !questions.data ? <Skeleton lines={5} /> : questions.data.items.length === 0 ? <EmptyState title="没有匹配的题目" description="调整搜索或状态筛选，也可以先导入新题。" /> : <>
        <QuestionList items={questions.data.items} selected={selected} onSelect={toggle} onEdit={setEditing} />
        <BulkConfirmBar count={selected.size} pending={bulk.isPending} onClear={() => setSelected(new Set())} onConfirm={() => bulk.mutate([...selected])} />
        <div className={styles.pagination}><button disabled={page === 1} onClick={() => setPage((value) => value - 1)}>上一页</button><span>第 {page} 页</span><button disabled={page * 20 >= questions.data.total} onClick={() => setPage((value) => value + 1)}>下一页</button></div>
      </>}
      {editing && <QuestionEditorSheet question={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); queryClient.invalidateQueries({ queryKey: ["questions"] }); }} />}
    </main>
  );
}
