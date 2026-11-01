import { defineConfig, devices } from '@playwright/test'

/**
 * 端到端测试：跑真实的前端 + API + worker + Postgres + Mailpit。
 * 先启动依赖：在仓库根目录执行 docker compose up -d
 * 然后：npm run e2e
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: 'http://localhost:5173',
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
  webServer: [
    {
      command: 'uv --directory ../backend run uvicorn app.main:app --port 8001',
      url: 'http://localhost:8001/api/v1/health',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
    },
  ],
})
