#!/usr/bin/env python3
"""
import_cookies.py
自动从浏览器读取 DTTW cookies 并保存，供 fetch_performance.py 使用。

自动流程：尝试从 Edge/Chrome 自动读取 → 失败时提示手动导出
"""

import json
import pickle
import os
import sys

SESSION_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "metro_cookies.pkl")
COOKIE_JSON = os.path.join(os.path.dirname(os.path.abspath(__file__)), "metro_cookies.json")

def save_cookies(cookies: dict) -> bool:
    """保存 cookies 到 pickle 和 JSON 文件"""
    try:
        with open(SESSION_FILE, "wb") as f:
            pickle.dump(cookies, f)
        with open(COOKIE_JSON, "w", encoding="utf-8") as f:
            cookie_list = [{"name": k, "value": v} for k, v in cookies.items()]
            json.dump(cookie_list, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        print(f"✗ 保存失败: {e}")
        return False

def load_from_browser() -> dict | None:
    """从浏览器自动读取 cookies"""
    try:
        import browser_cookie3
        for name, loader in [("Edge", browser_cookie3.edge), ("Chrome", browser_cookie3.chrome)]:
            try:
                jar = loader(domain_name="metro.dttw.com")
                cookies = {k: v for k, v in jar.items()}
                if cookies:
                    print(f"✓ 从 {name} 自动读取到 {len(cookies)} 个 cookies")
                    return cookies
            except PermissionError:
                print(f"  {name} 需要管理员权限（在非管理员环境可跳过）")
                continue
            except Exception as e:
                print(f"  {name} 读取失败: {e}")
                continue
    except ImportError:
        print("✗ 缺少 browser_cookie3 库")
    return None

def manual_input() -> dict | None:
    """手动输入 JSON"""
    print("\n" + "=" * 55)
    print("  手动导入 Cookies")
    print("=" * 55)
    print("请粘贴从 Cookie-Editor 导出的 JSON 内容")
    print("（粘贴后按两次回车）\n")

    lines = []
    empty_count = 0
    while True:
        try:
            line = input()
            if line == "":
                empty_count += 1
                if empty_count >= 2 and lines:
                    break
            else:
                empty_count = 0
                lines.append(line)
        except EOFError:
            break

    raw = "\n".join(lines).strip()
    if not raw:
        print("✗ 未检测到内容")
        return None

    try:
        cookie_list = json.loads(raw)
        cookies = {c["name"]: c["value"] for c in cookie_list if "name" in c and "value" in c}
        return cookies
    except json.JSONDecodeError as e:
        print(f"✗ JSON 格式错误: {e}")
        return None

print("=" * 55)
print("  Metro Cookies 导入工具")
print("=" * 55)
print("尝试从浏览器自动读取...\n")

cookies = load_from_browser()

if cookies:
    if save_cookies(cookies):
        print(f"✓ 已保存 {len(cookies)} 个 cookies")
        print(f"✓ pickle: {SESSION_FILE}")
        print(f"✓ json:   {COOKIE_JSON}")
        sys.exit(0)
else:
    print("✗ 自动读取失败，切换到手动模式")
    cookies = manual_input()
    if cookies and save_cookies(cookies):
        print(f"\n✓ 成功导入 {len(cookies)} 个 cookies")
        print(f"✓ 已保存至 {SESSION_FILE}")
        sys.exit(0)

print("✗ 导入失败")
sys.exit(1)
