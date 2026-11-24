import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { DueQuestion } from "../api/types";
import Md from "./Md";

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

interface Variant {
  stem: string;
  options: string[] | null;
  answer: string;
  explanation: string;
}

interface Props {
  question: DueQuestion;
  given: string;
  onClose: () => void;
  onNext: () => void;
}

/** 「问 AI」对话框（R-explain / R-session-11/12）。
 *  手动触发的每次请求才调模型；不阻塞主流程，随时收起回到下一题。 */
export default function ExplainPanel({ question, given, onClose, onNext }: Props) {
  const [history, setHistory] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [variant, setVariant] = useState<Variant | null>(null);
  const [showVariantAnswer, setShowVariantAnswer] = useState(false);
  const [added, setAdded] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [history, variant]);

  const ask = useCallback(
    async (opts: { text?: string; mode?: string; nextHistory?: ChatMsg[] }) => {
      if (busy) return;
      setBusy(true);
      setErr("");
      const text = opts.text?.trim();
      if (text) {
        setHistory((h) => [...h, { role: "user", content: text }]);
      }
      try {
        const r = await api<{ reply?: string; history?: ChatMsg[]; variant?: Variant }>(
          "/explain/ask",
          {
            method: "POST",
            body: {
              question_id: question.id,
              given,
              mode: opts.mode ?? "chat",
              history: (opts.nextHistory ?? history).slice(-10),
            },
          });
        if (r.variant) {
          setVariant(r.variant);
          setShowVariantAnswer(false);
        } else if (r.reply) {
          setHistory(r.history ?? []);
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : "请求失败");
        if (text) setHistory((h) => h.slice(0, -1)); // 失败撤回用户消息
      } finally {
        setBusy(false);
      }
    },
    [busy, question.id, given, history],
  );

  const quickChips = [
    { label: "为什么", text: "我为什么答错了？请讲清正确逻辑。" },
    { label: "结合项目举例", text: "请结合一个实际的软件工程项目场景举例说明。" },
  ];

  /** 变式题加入题库：继承原题的题库/分类/标签 */
  const addVariant = useCallback(async () => {
    if (!variant) return;
    try {
      await api("/questions", {
        method: "POST",
        body: {
          stem: variant.stem,
          answer: variant.answer,
          qtype: variant.options?.length ? "choice" : "qa",
          options: variant.options ?? [],
          explanation: variant.explanation,
          source: `AI 变式（原题 #${question.id}）`,
          tags: question.tags,
          difficulty: question.difficulty,
          category_id: question.category_id,
          bank_id: question.bank_id,
          status: "active",
        },
      });
      setAdded(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "加入失败");
    }
  }, [variant, question]);

  return (
    <div className="explain-mask">
      <div className="explain-panel">
        <div className="explain-head">
          <span className="explain-title">问 AI</span>
          <span className="explain-stem">{question.stem.replace(/[#*`>\n]/g, "").slice(0, 24)}</span>
          <button className="explain-next" onClick={() => { onNext(); onClose(); }}>下一题</button>
          <button className="explain-close" onClick={onClose} aria-label="收起">×</button>
        </div>

        <div className="explain-body" ref={listRef}>
          {history.length === 0 && !variant && !busy && (
            <div className="explain-hint">
              我会带着这道题和你的作答来回答。
              <br />
              点下面的快捷问题，或直接输入。
            </div>
          )}
          {history.map((m, i) => (
            <div key={i} className={`chat-msg ${m.role}`}>
              <Md>{m.content}</Md>
            </div>
          ))}
          {busy && <div className="chat-msg assistant"><span className="chat-thinking">想了一下…</span></div>}
          {err && <div className="chat-msg user"><span className="chat-err">{err}</span></div>}

          {variant && (
            <div className="variant-card">
              <div className="variant-tag">同类变式题</div>
              <div className="variant-stem"><Md>{variant.stem}</Md></div>
              {variant.options?.map((o) => <div key={o} className="variant-opt">{o}</div>)}
              {showVariantAnswer ? (
                <div className="variant-answer">
                  答案：<b>{variant.answer}</b>
                  {variant.explanation && <div className="fb-explain">{variant.explanation}</div>}
                </div>
              ) : (
                <button className="btn ghost" onClick={() => setShowVariantAnswer(true)}>
                  想好答案了，对照标准答案
                </button>
              )}
              <div className="variant-actions">
                {added ? (
                  <span className="variant-added">已加入题库</span>
                ) : (
                  <button className="btn" disabled={!showVariantAnswer} onClick={addVariant}>
                    加入题库
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="explain-chips">
          {quickChips.map((c) => (
            <button key={c.label} className="chip" disabled={busy}
              onClick={() => ask({ text: c.text })}>
              {c.label}
            </button>
          ))}
          <button className="chip" disabled={busy}
            onClick={() => ask({ mode: "variant" })}>
            再出同类题
          </button>
        </div>

        <div className="explain-input-row">
          <input
            value={input}
            placeholder="继续追问…"
            disabled={busy}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && input.trim()) {
                ask({ text: input });
                setInput("");
              }
            }}
          />
          <button className="btn" disabled={busy || !input.trim()}
            onClick={() => { ask({ text: input }); setInput(""); }}>
            发送
          </button>
        </div>
      </div>
    </div>
  );
}
