import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import Button from "../components/ui/Button";

interface SampleResult {
  bank_id: number;
  question_ids: number[];
}

/** 首次使用：用明确标识的示例内容体验完整复习闭环。 */
export default function OnboardingPage() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const createSample = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api<SampleResult>("/identity/onboarding/sample", { method: "POST" });
      navigate("/today", { replace: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "示例题创建失败，请重试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main id="view">
      <section className="login-box">
        <p>第一次来，先完成一轮短复习</p>
        <h1 className="view-title">从 3 道示例题开始</h1>
        <p>体验答题、评分和下一次复习安排。示例题会标记为“忙里偷题示例”，不会混入你的原始材料。</p>
        <Button block loading={busy} onClick={createSample}>一键体验 3 道示例题</Button>
        <Button block variant="ghost" disabled={busy} onClick={() => navigate("/add")}>先导入自己的题</Button>
        {error && <div className="form-msg err" role="alert">{error}</div>}
      </section>
    </main>
  );
}
