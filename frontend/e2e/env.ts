// E2E 用独立的端口和数据库，不会碰到正在运行的开发服务器和开发库（pa）。
// 每次运行前 pa_e2e 会被清空重建（见 backend/scripts/reset_db.py）。
export const WEB_URL = 'http://localhost:5174'
export const API_URL = 'http://localhost:8002'
export const E2E_DATABASE_URL = 'postgresql+asyncpg://pa:pa@localhost:5433/pa_e2e'
