/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 后端开发服务器地址（端口 8001，避免和本机其他项目冲突）
const API_TARGET = process.env.VITE_API_TARGET ?? 'http://localhost:8001'

export default defineConfig({
  // tanstackRouter 必须放在 react() 之前，否则路由生成会静默失败
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    strictPort: true,
    // 开发时前端和 API 同源：/api 由 Vite 转发到 FastAPI，与生产环境的 Caddy 行为一致
    proxy: { '/api': { target: API_TARGET, changeOrigin: false } },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
})
