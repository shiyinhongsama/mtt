import { useState } from "react";
import { api, setToken } from "../api/client";

/** 首次进入：粘贴 API token（R-identity-01 管理员发放），本地保存 */
export default function LoginPage() {
  const [token, setTokenInput] = useState("");
  const [err, setErr] = useState("");

  const enter = async () => {
    const t = token.trim();
    if (!t) return;
    setToken(t);
    try {
      await api("/identity/me");
      window.location.hash = "#/review";
      window.location.reload();
    } catch {
      setErr("token 无效，请检查");
    }
  };

  return (
    <main id="view">
      <div className="login-box">
        <div className="view-title">忙里偷题</div>
        <p>
          输入 API token 开始使用。
          <br />
          token 由管理员通过 <code>mtt user-create</code> 发放。
        </p>
        <div className="field">
          <input
            value={token}
            placeholder="粘贴 token"
            autoComplete="off"
            onChange={(e) => setTokenInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && enter()}
          />
        </div>
        <button className="btn block" onClick={enter}>进入</button>
        {err && <div className="form-msg err">{err}</div>}
        <p style={{ marginTop: 18 }}>
          管理员？<a href="/console/" style={{ color: "var(--accent)" }}>进入管理端</a>
        </p>
      </div>
    </main>
  );
}
