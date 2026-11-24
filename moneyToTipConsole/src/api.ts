/** 管理端 API 客户端：账号密码登录后签发 token，localStorage 保存（本机管理端） */

const TOKEN_KEY = "mttc_token";

export class AuthError extends Error {}

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? "";
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

interface ApiOptions {
  method?: string;
  body?: unknown;
}

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${getToken()}` };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  let r: Response;
  try {
    r = await fetch(`/api/v1${path}`, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new Error("网络不通，稍后再试");
  }

  if (r.status === 401) {
    clearToken();
    window.dispatchEvent(new Event("mttc:expired"));
    throw new AuthError("登录已失效，请重新登录");
  }
  if (r.status === 204) return undefined as T;
  if (!r.ok) {
    let detail = `请求失败 (${r.status})`;
    try {
      detail = (await r.json()).detail ?? detail;
    } catch {
      /* 忽略非 JSON 错误体 */
    }
    throw new Error(detail);
  }
  return (await r.json()) as T;
}
