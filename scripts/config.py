# config.py — fetch_performance.py 配置文件
# 凭据从 Windows Credential Manager 读取（keyring），此文件不含任何密码/密钥。
# 首次使用请先运行：python setup_credentials.py

import keyring

SERVICE = "dttw_fetch"

def _get(key: str) -> str:
    return keyring.get_password(SERVICE, key) or ""

# ── Supabase ─────────────────────────────────────────────────
SUPABASE_URL = "https://ieyljmelqcuqfxnchesu.supabase.co"
SUPABASE_KEY = _get("SUPABASE_KEY")

# ── 邮件通知 ─────────────────────────────────────────────────
SMTP_HOST    = _get("SMTP_HOST")
SMTP_PORT    = int(_get("SMTP_PORT") or "465")
SMTP_USER    = _get("SMTP_USER")
SMTP_PASS    = _get("SMTP_PASS")
NOTIFY_EMAIL = _get("NOTIFY_EMAIL")

# ── IMAP 收信（监听 DTTW 结算邮件）────────────────────────────
# 若未单独设置，自动从 SMTP_HOST 推断（smtp.qq.com → imap.qq.com）
IMAP_HOST    = _get("IMAP_HOST") or SMTP_HOST.replace("smtp", "imap", 1)
IMAP_PORT    = int(_get("IMAP_PORT") or "993")

# ── 启动检查（Metro 账号密码不再需要，改用 Chrome cookies）──
_required = {"SUPABASE_KEY": SUPABASE_KEY}
_missing  = [k for k, v in _required.items() if not v]
if _missing:
    raise EnvironmentError(
        f"以下凭据未设置：{', '.join(_missing)}\n"
        "请运行 python setup_credentials.py 完成配置。"
    )
