"""把 FastAPI 的 OpenAPI schema 导出成 JSON，供前端生成 TypeScript 类型。

用法：uv run python scripts/export_openapi.py ../frontend/openapi.json
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.main import app

out = Path(sys.argv[1] if len(sys.argv) > 1 else "openapi.json")
out.write_text(json.dumps(app.openapi(), indent=2, ensure_ascii=False) + "\n")
print(f"wrote {out}")
