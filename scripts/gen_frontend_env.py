#!/usr/bin/env python3
"""
gen_frontend_env.py
从 config.py + Credential Manager 生成前端 .env 文件

使用方式：
    python scripts/gen_frontend_env.py

前置条件：
    运行过 python scripts/setup_credentials.py 来保存 SUPABASE_ANON_KEY
"""

import sys
import keyring
from pathlib import Path

# 从 config.py 读取 Supabase URL
sys.path.insert(0, str(Path(__file__).parent))
from config import SUPABASE_URL

SERVICE = "dttw_fetch"

print("=" * 70)
print("前端 .env 生成向导")
print("=" * 70)
print(f"✓ 已从 config.py 读取 SUPABASE_URL: {SUPABASE_URL}")
print()

# 从 Credential Manager 读取 Anon Key
anon_key = keyring.get_password(SERVICE, "SUPABASE_ANON_KEY")

if anon_key:
    print(f"✓ 已从 Credential Manager 读取 SUPABASE_ANON_KEY")
    print()
else:
    print("✗ 错误：未在 Credential Manager 中找到 SUPABASE_ANON_KEY")
    print()
    print("请先运行：")
    print("  python scripts/setup_credentials.py")
    print()
    print("然后输入 SUPABASE_ANON_KEY（从 Supabase Dashboard → Settings → API → Publishable key）")
    sys.exit(1)

# 生成 .env 文件
frontend_dir = Path(__file__).parent.parent / "frontend"
env_file = frontend_dir / ".env"

env_content = f"""VITE_SUPABASE_URL={SUPABASE_URL}
VITE_SUPABASE_ANON_KEY={anon_key}
"""

# 写入文件
try:
    env_file.write_text(env_content)
    print("=" * 70)
    print(f"✓ .env 文件已创建：{env_file}")
    print("=" * 70)
    print()
    print("下一步在 frontend 目录运行：")
    print("  npm run build")
    print("  git add dist .env")
    print("  git commit -m 'Add: Supabase config for frontend'")
    print("  git push origin gh-pages --force")
    print()
except Exception as e:
    print(f"✗ 错误：无法写入 .env 文件：{e}")
    sys.exit(1)
