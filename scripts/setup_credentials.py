#!/usr/bin/env python3
"""
setup_credentials.py
一次性运行：把所有凭据存入 Windows Credential Manager（加密保管）
之后 config.py 会自动从 Credential Manager 读取，不需要再改任何文件。

运行方式：
    python setup_credentials.py
"""

import keyring
import getpass

SERVICE = "dttw_fetch"

FIELDS = [
    ("SUPABASE_KEY",       "Supabase service_role key（后端）",             False),
    ("SUPABASE_ANON_KEY",  "Supabase Anon Key / Publishable key（前端）",   False),
    ("METRO_USER",         "DTTW Metro 登录邮箱",                           False),
    ("METRO_PASS",         "DTTW Metro 登录密码",                           True),
    ("SMTP_HOST",          "SMTP 服务器（如 smtp.qq.com）",                 False),
    ("SMTP_PORT",          "SMTP 端口（QQ/163用465，Gmail用587）",           False),
    ("SMTP_USER",          "发件邮箱地址",                                   False),
    ("SMTP_PASS",          "邮箱授权码（非登录密码）",                        True),
    ("NOTIFY_EMAIL",       "收件邮箱地址",                                   False),
    ("IMAP_HOST",          "IMAP 服务器（QQ留空自动推断为 imap.qq.com）",    False),
    ("IMAP_PORT",          "IMAP 端口（默认993，留空即可）",                  False),
]

print("=" * 55)
print("  DTTW 凭据设置向导（存入 Windows Credential Manager）")
print("=" * 55)
print("输入后按回车，密码类字段不会回显。")
print("如果某项已设置过、不想修改，直接按回车跳过。\n")

for key, label, is_secret in FIELDS:
    existing = keyring.get_password(SERVICE, key)
    hint = "（已设置，回车跳过）" if existing else ""
    prompt = f"{label}{hint}: "
    try:
        value = getpass.getpass(prompt) if is_secret else input(prompt)
    except (EOFError, KeyboardInterrupt):
        print("\n已取消")
        break
    if value.strip():
        keyring.set_password(SERVICE, key, value.strip())
        print(f"  ✓ {key} 已保存\n")
    else:
        if existing:
            print(f"  → {key} 保持不变\n")
        else:
            print(f"  ⚠ {key} 未设置（跳过）\n")

print("=" * 55)
print("完成！凭据已加密存储在 Windows Credential Manager。")
print("可在「控制面板 → 凭据管理器 → Windows 凭据」里查看（名称以 dttw_fetch 开头）。")
print("=" * 55)
