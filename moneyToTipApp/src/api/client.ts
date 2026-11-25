/** API 客户端：Bearer token 鉴权，并保留可恢复的错误分类。 */

const TOKEN_KEY = "mtt_token";

export type ApiErrorKind = "network" | "auth" | "validation" | "conflict" | "server";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly kind: ApiErrorKind,
    public readonly status: number | null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class AuthError extends ApiError {
  constructor(message = "登录已失效") {
    super(message, "auth", 401);
    this.name = "AuthError";
  }
}

export function errorKind(status: number): ApiErrorKind {
  if (status === 401) return "auth";
  if (status === 409) return "conflict";
  if (status === 400 || status === 422) return "validation";
  return "server";
}

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? "";
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export interface ApiOptions {
  method?: string;
  body?: unknown;
}

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${getToken()}` };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError("网络不通，稍后再试", "network", null);
  }

  if (response.status === 401) {
    clearToken();
    window.dispatchEvent(new Event("mtt:reauth"));
    throw new AuthError();
  }
  if (response.status === 204) return undefined as T;
  if (!response.ok) {
    let detail = `请求失败 (${response.status})`;
    try {
      const body = await response.json() as { detail?: unknown };
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      // 非 JSON 错误体使用通用状态文案。
    }
    throw new ApiError(detail, errorKind(response.status), response.status);
  }
  return (await response.json()) as T;
}
