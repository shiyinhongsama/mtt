import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, setToken } from "../api/client";
import Button from "../components/ui/Button";

interface LoginResult {
  token: string;
  username: string;
  role: "admin" | "user";
}

interface CurrentUser {
  id: number;
  username: string;
  role: string;
}

/** 学习端账号密码登录；登录成功后由 App 响应当前认证状态。 */
export default function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const enter = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      const login = await api<LoginResult>("/identity/login", {
        method: "POST",
        body: { username: username.trim(), password },
      });
      setToken(login.token);
      await api<CurrentUser>("/identity/me");
      const questions = await api<{ total: number }>("/questions?status=&page=1&page_size=1");
      navigate(questions.total === 0 ? "/onboarding" : "/today", { replace: true });
    } catch (error) {
      setErr(error instanceof Error ? error.message : "登录失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main id="view">
      <div className="login-box">
        <div className="view-title">忙里偷题</div>
        <p>用少量、按时的复习，把零碎时间变成长期记忆。</p>
        <form onSubmit={enter}>
          <div className="field">
            <label htmlFor="login-username">用户名</label>
            <input
              id="login-username"
              value={username}
              placeholder="请输入用户名"
              autoComplete="username"
              required
              onChange={(event) => setUsername(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="login-password">密码</label>
            <input
              id="login-password"
              type="password"
              value={password}
              placeholder="请输入密码"
              autoComplete="current-password"
              required
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <Button type="submit" block loading={busy}>登录</Button>
        </form>
        {err && <div className="form-msg err" role="alert">{err}</div>}
        <p style={{ marginTop: 18 }}>
          管理员？<a href="/console/" style={{ color: "var(--accent)" }}>进入管理端</a>
        </p>
      </div>
    </main>
  );
}
