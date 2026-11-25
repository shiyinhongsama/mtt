import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  expect,
  test as base,
  type APIResponse,
  type Page,
  type TestInfo,
} from "@playwright/test";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const backendDir = resolve(appDir, "../moneyToTip");
const viteBin = join(appDir, "node_modules", "vite", "bin", "vite.js");

export const credentials = { username: "e2e-user", password: "e2e-local-password" };

interface IsolatedBackend {
  appUrl: string;
  reviewLogs: () => { question_id: number; client_id: string }[];
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("无法分配测试端口");
  const port = address.port;
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  return port;
}

function testEnv(databasePath: string, outputPath: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    MTT_DATABASE_URL: `sqlite:///${databasePath.replaceAll("\\", "/")}`,
    MTT_DATA_DIR: join(outputPath, "data"),
    MTT_WEBAPP_DIST: join(outputPath, "no-webapp"),
    MTT_CONSOLE_DIST: join(outputPath, "no-console"),
  };
}

function runSeed(databasePath: string, outputPath: string): void {
  const script = [
    "from sqlmodel import Session",
    "from mtt.db import engine, init_db",
    "from mtt.identity.service import create_user",
    "init_db()",
    "with Session(engine) as session:",
    `    create_user(session, ${JSON.stringify(credentials.username)}, password=${JSON.stringify(credentials.password)}, role='user')`,
  ].join("\n");
  const result = spawnSync("uv", ["run", "--frozen", "python", "-c", script], {
    cwd: backendDir,
    env: testEnv(databasePath, outputPath),
    encoding: "utf8",
    timeout: 30_000,
  });
  if (result.status !== 0) {
    throw new Error(`隔离测试库初始化失败：${result.stderr || result.stdout || result.error?.message}`);
  }
}

function startLogged(command: string, args: string[], options: {
  cwd: string;
  env: NodeJS.ProcessEnv;
  logPath: string;
}): ChildProcess {
  mkdirSync(dirname(options.logPath), { recursive: true });
  const log = openSync(options.logPath, "a");
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", log, log],
    windowsHide: true,
  });
  closeSync(log);
  return child;
}

async function waitForHttp(url: string, child: ChildProcess, logPath: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // 服务尚未监听，继续按条件等待。
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  const log = readFileSync(logPath, "utf8");
  throw new Error(`测试服务启动失败：${url}\n${log}`);
}

function stop(child: ChildProcess | undefined): void {
  if (!child || child.exitCode !== null || !child.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
}

/** 每个测试启动独立的 FastAPI、Vite 和 SQLite；绝不复用开发数据库。 */
export const test = base.extend<{ isolatedBackend: IsolatedBackend; baseURL: string | undefined }>({
  isolatedBackend: [async ({}, use, testInfo: TestInfo) => {
    const outputPath = testInfo.outputPath("isolated-server");
    const databasePath = join(outputPath, "test.sqlite");
    mkdirSync(outputPath, { recursive: true });
    runSeed(databasePath, outputPath);

    const apiPort = await freePort();
    const webPort = await freePort();
    const apiOrigin = `http://127.0.0.1:${apiPort}`;
    const webOrigin = `http://127.0.0.1:${webPort}`;
    const env = testEnv(databasePath, outputPath);
    const apiLog = join(outputPath, "api.log");
    const webLog = join(outputPath, "web.log");
    let apiProcess: ChildProcess | undefined;
    let webProcess: ChildProcess | undefined;

    try {
      apiProcess = startLogged("uv", [
        "run", "--frozen", "uvicorn", "mtt.main:app",
        "--host", "127.0.0.1", "--port", String(apiPort),
      ], { cwd: backendDir, env, logPath: apiLog });
      await waitForHttp(`${apiOrigin}/health`, apiProcess, apiLog);

      webProcess = startLogged(process.execPath, [
        viteBin, "--host", "127.0.0.1", "--port", String(webPort), "--strictPort",
      ], {
        cwd: appDir,
        env: { ...env, MTT_API_ORIGIN: apiOrigin },
        logPath: webLog,
      });
      await waitForHttp(`${webOrigin}/app/`, webProcess, webLog);

      await use({
        appUrl: `${webOrigin}/app/`,
        reviewLogs: () => {
          const script = [
            "import json, sqlite3, sys",
            "connection = sqlite3.connect(sys.argv[1])",
            "rows = connection.execute('SELECT question_id, client_id FROM reviewlog ORDER BY id').fetchall()",
            "print(json.dumps([{'question_id': row[0], 'client_id': row[1]} for row in rows]))",
          ].join("\n");
          const result = spawnSync("uv", ["run", "--frozen", "python", "-c", script, databasePath], {
            cwd: backendDir,
            env,
            encoding: "utf8",
            timeout: 15_000,
          });
          if (result.status !== 0) throw new Error(`读取复习日志失败：${result.stderr}`);
          return JSON.parse(result.stdout.trim());
        },
      });
    } finally {
      stop(webProcess);
      stop(apiProcess);
    }
  }, { auto: true }],
  baseURL: async ({ isolatedBackend }, use) => {
    await use(isolatedBackend.appUrl);
  },
});

export { expect };

export async function login(page: Page): Promise<void> {
  await page.goto("./#/login");
  await page.getByLabel("用户名", { exact: true }).fill(credentials.username);
  await page.getByLabel("密码", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/#\/onboarding$/);
  await expect(page.getByRole("heading", { name: "从 3 道示例题开始" })).toBeVisible();
}

export async function createSampleAndOpenToday(page: Page): Promise<void> {
  await page.getByRole("button", { name: "一键体验 3 道示例题" }).click();
  await expect(page).toHaveURL(/#\/today$/);
  await expect(page.getByRole("heading", { name: "把零碎时间，变成长期记忆" })).toBeVisible();
}

export async function api(page: Page, path: string, options: {
  method?: string;
  body?: unknown;
} = {}): Promise<APIResponse> {
  const token = await page.evaluate(() => localStorage.getItem("mtt_token"));
  if (!token) throw new Error("当前页面没有测试登录凭证");
  const response = await page.request.fetch(`/api/v1${path}`, {
    method: options.method ?? "GET",
    headers: { Authorization: `Bearer ${token}` },
    data: options.body,
  });
  if (!response.ok()) throw new Error(`测试 API 失败：${response.status()} ${await response.text()}`);
  return response;
}

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() =>
    document.documentElement.scrollWidth <= window.innerWidth,
  )).toBe(true);
}
