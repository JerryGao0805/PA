import { defineConfig, devices } from '@playwright/test'

import { API_URL, E2E_DATABASE_URL, WEB_URL } from './e2e/env.ts'

/**
 * 端到端测试：跑真实的前端 + API + worker + Postgres + Mailpit。
 * 先启动依赖：在仓库根目录执行 docker compose up -d
 * 然后：npm run e2e
 */

// webServer 的 env 会整个替换掉子进程的环境变量，所以要带上当前的（PATH 等）
const withEnv = (extra: Record<string, string>) => ({
  ...(Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)) as Record<
    string,
    string
  >),
  ...extra,
})
const backendEnv = withEnv({
  PA_DATABASE_URL: E2E_DATABASE_URL,
  PA_APP_BASE_URL: WEB_URL,
  PA_EMAIL_BACKEND: 'smtp',
})
const apiPort = new URL(API_URL).port
const webPort = new URL(WEB_URL).port

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      // 本地复用已安装的 Chrome，免去下载；CI 上用 Playwright 自带的 Chromium
      use: { ...devices['Desktop Chrome'], channel: process.env.CI ? undefined : 'chrome' },
    },
  ],
  // 按顺序启动：先重建数据库再启动 API，然后是 worker 和前端
  webServer: [
    {
      name: 'api',
      command: `uv --directory ../backend run python scripts/reset_db.py && uv --directory ../backend run uvicorn app.main:app --port ${apiPort}`,
      url: `${API_URL}/api/v1/health`,
      env: backendEnv,
      reuseExistingServer: !process.env.CI,
    },
    {
      // worker 不监听端口，等它打印启动日志
      name: 'worker',
      command: 'uv --directory ../backend run python -m app.worker',
      wait: { stderr: /worker started/ },
      env: backendEnv,
    },
    {
      name: 'web',
      command: `npm run dev -- --port ${webPort}`,
      url: WEB_URL,
      env: withEnv({ VITE_API_TARGET: API_URL }),
      reuseExistingServer: !process.env.CI,
    },
  ],
})
