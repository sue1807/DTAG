#!/usr/bin/env python3
"""
backfill.py
补录指定日期范围的历史数据，用法：
    python backfill.py 2026-06-01 2026-06-09
不传参数默认补录本月至昨天。
"""

import sys
import os
import pickle
import logging
from datetime import date, timedelta, datetime

# 复用主脚本的所有函数
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_performance import (
    load_session, is_logged_in, refresh_from_chrome,
    fetch_csv, upsert_rows, TRADER_CSV_BASES,
    SUPABASE_URL, SUPABASE_KEY
)
from supabase import create_client

logging.basicConfig(level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    handlers=[logging.StreamHandler()])
log = logging.getLogger(__name__)

def daterange(start: date, end: date):
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)

def main():
    today = date.today()
    if len(sys.argv) == 3:
        start = date.fromisoformat(sys.argv[1])
        end   = date.fromisoformat(sys.argv[2])
    else:
        start = today.replace(day=1)
        end   = today - timedelta(days=1)

    log.info(f"补录范围：{start} → {end}")
    sb      = create_client(SUPABASE_URL, SUPABASE_KEY)
    session = load_session()

    if not is_logged_in(session):
        if not refresh_from_chrome(session):
            log.error("登录失败，请先运行 import_cookies.py")
            return

    total = 0
    for target in daterange(start, end):
        all_rows = []
        for trader_id in TRADER_CSV_BASES:
            rows = fetch_csv(session, trader_id, target)
            if rows is None:
                if not refresh_from_chrome(session):
                    log.error("cookies 失效，中止")
                    return
                rows = fetch_csv(session, trader_id, target) or []
            all_rows.extend(rows)

        if all_rows:
            upsert_rows(sb, all_rows)
            total += len(all_rows)
        else:
            log.info(f"  {target} 无数据（非交易日）")

    log.info(f"完成，共写入 {total} 条记录")

if __name__ == "__main__":
    main()
