#!/usr/bin/env python3
"""
fetch_performance.py
姣忓ぉ 20:00锛堝寳浜椂闂达級鐢?Windows 浠诲姟璁″垝绋嬪簭鑷姩杩愯锛屽畬鎴愪笁椤逛换鍔★細

  鈶?姣忔棩涓氱哗鎶撳彇锛氫笅杞芥槰鏃ヤ笁浣嶄氦鏄撳憳 CSV 鈫?鍐欏叆 daily_performance
  鈶?Settlement PDF 鎶撳彇锛氬皾璇曚笅杞戒笂鏈?Settlement PDF 鈫?瑙ｆ瀽 鈫?鍐欏叆 settlement_records + period_fees
  鈶?鏈堝害涓氱哗鏍稿锛氱洃鍚?QQ 閭涓殑 DTTW 缁撶畻閭欢 鈫?瑙﹀彂鎶撳彇鏁存湀涓氱哗 CSV
     鈫?涓?daily_performance 鏈堝害绱瀵规瘮 鈫?宸紓鍐欏叆 trade_records.discrepancy_note

鐧诲綍鏂瑰紡锛氳鍙?Edge/Chrome 娴忚鍣ㄧ殑 metro.dttw.com cookies锛堟棤闇€璐﹀彿瀵嗙爜锛夈€?cookies 澶辨晥鏃讹紝鍦ㄦ祻瑙堝櫒鎵嬪姩鐧诲綍涓€娆★紝閲嶆柊杩愯鍗冲彲銆?"""

import requests
import csv
import io
import re
import os
import json
import pickle
import logging
import smtplib
import imaplib
import email as email_lib
import ssl
from email.header import decode_header
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from datetime import date, timedelta, datetime
from calendar import monthrange

from supabase import create_client

# 鈹€鈹€ 鏃ュ織 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    handlers=[
        logging.FileHandler(
            os.path.join(os.path.dirname(__file__), "fetch_performance.log"),
            encoding="utf-8"
        ),
        logging.StreamHandler(),
    ],
)
log = logging.getLogger(__name__)

# 鈹€鈹€ 璺緞 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
_DIR         = os.path.dirname(os.path.abspath(__file__))
SESSION_FILE = os.path.join(_DIR, "metro_cookies.pkl")
CONFIG_FILE  = os.path.join(_DIR, "config.py")

# 鈹€鈹€ 璇诲彇閰嶇疆 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
try:
    import importlib.util
    spec = importlib.util.spec_from_file_location("config", CONFIG_FILE)
    cfg  = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cfg)
    SUPABASE_URL = cfg.SUPABASE_URL
    SUPABASE_KEY = cfg.SUPABASE_KEY
    SMTP_HOST    = cfg.SMTP_HOST
    SMTP_PORT    = cfg.SMTP_PORT
    SMTP_USER    = cfg.SMTP_USER
    SMTP_PASS    = cfg.SMTP_PASS
    NOTIFY_EMAIL = cfg.NOTIFY_EMAIL
    IMAP_HOST    = cfg.IMAP_HOST
    IMAP_PORT    = cfg.IMAP_PORT
except Exception as e:
    log.error(f"failed to read config.py: {e}")
    raise

# 鈹€鈹€ 浜ゆ槗鍛?CSV URL 妯℃澘锛堝彧鍚浐瀹氬弬鏁帮紝鏃ユ湡鐢?build_url 鎷兼帴锛夆攢鈹€
TRADER_CSV_BASES = {
    "HONG045": ("https://metro.dttw.com/metro/BOP-TraderTotalSummary/2634625/AUNZ"
                "?field_bop_pnl_office_id_nid=43897221&field_bop_pnl_trader_id_uid=1508040"
                "&field_bop_pnl_currency_nid=135&field_bop_pnl_market_nid=All"),
    "PENGCDU": ("https://metro.dttw.com/metro/BOP-TraderTotalSummary/2634625/AUNZ"
                "?field_bop_pnl_office_id_nid=43897221&field_bop_pnl_trader_id_uid=1043813"
                "&field_bop_pnl_currency_nid=135&field_bop_pnl_market_nid=All"),
    "LULUSHI": ("https://metro.dttw.com/metro/BOP-TraderTotalSummary/3/ASIA"
                "?field_bop_pnl_office_id_nid=43897221&field_bop_pnl_trader_id_uid=433944"
                "&field_bop_pnl_currency_nid=125&field_bop_pnl_market_nid=All"),
}

TRADER_NAMES = {"HONG045": "王博", "PENGCDU": "马金斗", "LULUSHI": "石路路"}
TRADER_CCY   = {"HONG045": "AUD", "PENGCDU": "AUD",  "LULUSHI": "HKD"}
TRADER_RESERVE_USD = {"HONG045": 1000, "PENGCDU": 1000, "LULUSHI": 500}


# 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲
#  URL / Session 宸ュ叿
# 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲

def build_url(base: str, date_str: str) -> str:
    """Build single-day URL."""
    d = date_str.replace("/", "%2F")
    return (f"{base}&field_bop_pnl_date_value%5Bvalue%5D%5Bdate%5D={d}"
            f"&field_bop_pnl_date_value_1%5Bvalue%5D%5Bdate%5D={d}")


def build_url_range(base: str, start: str, end: str) -> str:
    """Build date-range URL."""
    s = start.replace("/", "%2F")
    e = end.replace("/", "%2F")
    return (f"{base}&field_bop_pnl_date_value%5Bvalue%5D%5Bdate%5D={s}"
            f"&field_bop_pnl_date_value_1%5Bvalue%5D%5Bdate%5D={e}")


COOKIE_TXT  = os.path.join(_DIR, "metro_cookies.txt")   # Netscape format (Get cookies.txt plugin)
COOKIE_JSON = os.path.join(_DIR, "metro_cookies.json")  # JSON format (Cookie-Editor plugin)


def _load_cookies_from_file(session: requests.Session) -> bool:
    """Load cookies from exported JSON or Netscape cookies.txt."""
    # JSON 鏍煎紡锛歔{"name":..., "value":..., "domain":..., ...}, ...]
    if os.path.exists(COOKIE_JSON):
        try:
            with open(COOKIE_JSON, "r", encoding="utf-8") as f:
                cookies = json.load(f)
            for c in cookies:
                session.cookies.set(c["name"], c["value"], domain=c.get("domain", ""), path=c.get("path", "/"))
            log.info(f"loaded {len(cookies)} cookies from metro_cookies.json")
            return True
        except Exception as e:
            log.warning(f"failed to read metro_cookies.json: {e}")
    # Netscape 鏍煎紡锛歝ookies.txt
    if os.path.exists(COOKIE_TXT):
        try:
            import http.cookiejar
            jar = http.cookiejar.MozillaCookieJar(COOKIE_TXT)
            jar.load(ignore_discard=True, ignore_expires=True)
            session.cookies.update(jar)
            log.info("loaded cookies from metro_cookies.txt")
            return True
        except Exception as e:
            log.warning(f"failed to read metro_cookies.txt: {e}")
    return False


def load_session() -> requests.Session:
    session = requests.Session()
    session.headers["User-Agent"] = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 Chrome/124.0 Safari/537.36"
    )
    # 浼樺厛锛氱紦瀛?pkl
    if os.path.exists(SESSION_FILE):
        try:
            with open(SESSION_FILE, "rb") as f:
                session.cookies.update(pickle.load(f))
            log.info("loaded cached cookies")
            return session
        except Exception as e:
            log.warning(f"failed to load cached cookies: {e}")
    # 娆￠€夛細鎵嬪姩瀵煎嚭鐨?JSON / Netscape 鏂囦欢
    if _load_cookies_from_file(session):
        with open(SESSION_FILE, "wb") as f:
            pickle.dump(dict(session.cookies), f)
        return session
    # 鏈€鍚庯細灏濊瘯浠庢祻瑙堝櫒璇伙紙Chrome 127+ 閫氬父浼氬け璐ワ級
    return _load_from_browser(session)


def _load_from_browser(session: requests.Session) -> requests.Session:
    try:
        import browser_cookie3
        for name, loader in [("Edge", browser_cookie3.edge), ("Chrome", browser_cookie3.chrome)]:
            try:
                session.cookies.update(loader(domain_name="metro.dttw.com"))
                log.info(f"loaded cookies from {name}")
                with open(SESSION_FILE, "wb") as f:
                    pickle.dump(dict(session.cookies), f)
                return session
            except Exception as e:
                log.warning(f"failed to load cookies from {name}: {e}")
    except ImportError:
        pass
    log.error("cookies load failed; export metro_cookies.txt and retry")
    return session


def is_logged_in(session: requests.Session) -> bool:
    try:
        r = session.get("https://metro.dttw.com/metro/TraderSummary/3/ASIA",
                        allow_redirects=False, timeout=15)
        return r.status_code == 200
    except Exception:
        return False


def refresh_from_browser(session: requests.Session) -> bool:
    log.info("trying to reload cookies...")
    if os.path.exists(SESSION_FILE):
        os.remove(SESSION_FILE)
    session.cookies.clear()
    if not _load_cookies_from_file(session):
        _load_from_browser(session)
    return is_logged_in(session)


# 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲
#  鈶?姣忔棩涓氱哗 CSV 鎶撳彇
# 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲

def _parse_csv_rows(content: str) -> list:
    reader = csv.DictReader(io.StringIO(content))
    rows = []
    for row in reader:
        raw_date = row.get("Date", "").strip()
        if not raw_date:
            continue
        try:
            d = datetime.strptime(raw_date, "%m/%d/%Y").date()
        except ValueError:
            continue
        def n(key, default=0.0):
            v = row.get(key, "").strip().replace(",", "")   # 去千分位逗号，否则 float("-1,502.52") 会抛异常被吞成 0
            try: return float(v) if v else default
            except ValueError: return default
        rows.append({
            "trade_date":     d.isoformat(),
            "trader_name":    None,      # filled by caller
            "currency":       row.get("Currency", "").strip(),
            "gross":          n("Gross"),
            "gateway_charge": n("Gateway Charge"),
            "sec_fee":        n("Sec Fee"),
            "act_fee":        n("Act Fee"),
            "clr_fee":        n("Clr Fee"),
            "exe_fee":        n("Exe Fee"),
            "trading_total":  n("Trading Total"),
            "shares_traded":  int(n("Shares Traded")),
            "trades_made":    int(n("#Of Trades Made")),
        })
    return rows


def fetch_daily_csv(session: requests.Session, trader_id: str, target: date):
    """Fetch one daily CSV. None means session expired; [] means no rows."""
    date_str = target.strftime("%m/%d/%Y")
    url = build_url(TRADER_CSV_BASES[trader_id], date_str)
    log.info(f"  Daily {trader_id} {date_str} ...")
    try:
        resp = session.get(url, timeout=30)
    except Exception as e:
        log.error(f"  request failed: {e}"); return []
    if resp.status_code != 200:
        log.error(f"  HTTP {resp.status_code}"); return []
    if ("two-factor" in resp.url or
            (resp.headers.get("Content-Type", "").startswith("text/html")
             and "login" in resp.text[:500].lower())):
        log.warning("  session expired"); return None
    rows = _parse_csv_rows(resp.content.decode("utf-8-sig"))
    for r in rows:
        r["trader_name"] = trader_id
    log.info(f"  -> {len(rows)} rows")
    return rows


def fetch_monthly_csv(session: requests.Session, trader_id: str, period: str):
    """鎶撳彇鏁存湀 CSV锛沺eriod='YYYY-MM'"""
    year, month = int(period[:4]), int(period[5:7])
    _, last_day = monthrange(year, month)
    start = f"{month:02d}/01/{year}"
    end   = f"{month:02d}/{last_day:02d}/{year}"
    url   = build_url_range(TRADER_CSV_BASES[trader_id], start, end)
    log.info(f"  Monthly {trader_id} {period} ({start}->{end}) ...")
    try:
        resp = session.get(url, timeout=60)
    except Exception as e:
        log.error(f"  request failed: {e}"); return []
    if resp.status_code != 200:
        log.error(f"  HTTP {resp.status_code}"); return []
    if (resp.headers.get("Content-Type", "").startswith("text/html")
            and "login" in resp.text[:500].lower()):
        log.warning("  session expired"); return None
    rows = _parse_csv_rows(resp.content.decode("utf-8-sig"))
    for r in rows:
        r["trader_name"] = trader_id
    log.info(f"  -> {len(rows)} rows")
    return rows


# 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲
#  鈶?Settlement PDF 鎶撳彇涓庤В鏋?# 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲

def _to_num(s: str) -> float:
    if not s:
        return 0.0
    try:
        return float(s.replace(",", "").strip())
    except ValueError:
        return 0.0


def parse_settlement_pdf(content: bytes) -> dict:
    """Parse Settlement PDF bytes into settlement_records payload."""
    try:
        import pdfplumber
    except ImportError:
        log.error("missing pdfplumber; please run: pip install pdfplumber")
        return {}

    full_text = ""
    try:
        with pdfplumber.open(io.BytesIO(content)) as pdf:
            for page in pdf.pages:
                t = page.extract_text(x_tolerance=3, y_tolerance=3)
                if t:
                    full_text += t + "\n"
    except Exception as e:
        log.error(f"failed to read PDF text: {e}")
        return {}

    def g(pattern):
        m = re.search(pattern, full_text)
        return _to_num(m.group(1)) if m else None

    # 鈹€鈹€ Equity / Cut / Net 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
    eq = re.search(r'Equity\s+([\d,]+\.?\d*)\s+([-\d,]+\.?\d*)', full_text)
    ct = re.search(r'Cut\s+\d+%\s+([\d,]+\.?\d*)\s+([-\d,]+\.?\d*)', full_text)
    nt = re.search(r'Net\s+\d+%\s+([\d,]+\.?\d*)\s+([-\d,]+\.?\d*)', full_text)
    tx = re.search(r'Total Transaction Fees\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)', full_text)

    equity_aud = _to_num(eq.group(1)) if eq else None
    equity_hkd = _to_num(eq.group(2)) if eq else None
    cut_aud    = _to_num(ct.group(1)) if ct else None
    cut_hkd    = _to_num(ct.group(2)) if ct else None
    net_aud    = _to_num(nt.group(1)) if nt else None
    net_hkd    = _to_num(nt.group(2)) if nt else None
    exe_aud    = _to_num(tx.group(1)) if tx else None
    exe_hkd    = _to_num(tx.group(2)) if tx else None

    # 鈹€鈹€ Post Exchange Total锛堝彇 USD 鍒楋紝鍗崇涓変釜鏁帮級鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
    pe_total = re.search(
        r'Post Exchange Total\s+([\d,.]*)\s+([\d,.]*)\s+([\d,]+\.?\d*)', full_text)
    post_exchange_usd = _to_num(pe_total.group(3)) if pe_total else None

    # 鈹€鈹€ Wire Fees 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
    wire = re.search(
        r'(?:Last month(?:\'s)?\s+\d+\s+wires?|Wire fees?)\s+([\d,]+\.?\d*)',
        full_text, re.IGNORECASE)
    wire_fees_usd = _to_num(wire.group(1)) if wire else None

    # 鈹€鈹€ Loss Coverage 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
    loss_coverage = []
    lc_m = re.search(
        r'Loss Coverage Currency Exchange([\s\S]*?)(?:Payment Currency Exchange|Powered by|$)',
        full_text)
    if lc_m:
        for m in re.finditer(
                r'(AUD|HKD|USD)\s+([\d,]+\.?\d*)\s+(AUD|HKD|USD)\s+([-\d,]+\.?\d*)\s+([\d.]+)',
                lc_m.group(1)):
            loss_coverage.append({
                "from_ccy":    m.group(1),
                "from_amount": _to_num(m.group(2)),
                "to_ccy":      m.group(3),
                "to_amount":   _to_num(m.group(4)),
                "rate":        float(m.group(5)),
            })

    # 鈹€鈹€ Payment Exchange 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
    payment_exchange = []
    pe_m = re.search(
        r'Payment Currency Exchange([\s\S]*?)(?:ERP Deposits|Powered by|Entitlements Breakdown|$)',
        full_text)
    if pe_m:
        for m in re.finditer(
                r'(AUD|HKD|USD)\s+([\d,]+\.?\d*)\s+(AUD|HKD|USD)\s+([\d,]+\.?\d*)\s+([\d.]+)',
                pe_m.group(1)):
            payment_exchange.append({
                "from_ccy":    m.group(1),
                "from_amount": _to_num(m.group(2)),
                "to_ccy":      m.group(3),
                "to_amount":   _to_num(m.group(4)),
                "rate":        float(m.group(5)),
            })

    return {
        "equity_aud": equity_aud, "cut_aud": cut_aud, "net_aud": net_aud, "exe_aud": exe_aud,
        "equity_hkd": equity_hkd, "cut_hkd": cut_hkd, "net_hkd": net_hkd, "exe_hkd": exe_hkd,
        "post_exchange_usd": post_exchange_usd,
        "wire_fees_usd":     wire_fees_usd,
        "loss_coverage":     loss_coverage,
        "payment_exchange":  payment_exchange,
        "erp_deposits":      [],
        "erp_withdrawals":   [],
    }


def derive_fx_rates(parsed: dict) -> tuple:
    """Derive FX2 from payment_exchange and loss_coverage."""
    pe = parsed.get("payment_exchange", [])
    lc = parsed.get("loss_coverage", [])

    pe_aud_usd = next((r for r in pe if r["from_ccy"] == "AUD" and r["to_ccy"] == "USD"), None)
    pe_hkd_usd = next((r for r in pe if r["from_ccy"] == "HKD" and r["to_ccy"] == "USD"), None)
    lc_aud_hkd = next((r for r in lc if r["from_ccy"] == "AUD" and r["to_ccy"] == "HKD"), None)

    fx_aud_usd = pe_aud_usd["rate"] if pe_aud_usd else 0.0
    if pe_hkd_usd:
        fx_hkd_usd = pe_hkd_usd["rate"]
    elif lc_aud_hkd and fx_aud_usd:
        fx_hkd_usd = lc_aud_hkd["rate"] * fx_aud_usd
    else:
        fx_hkd_usd = 0.0

    return fx_aud_usd, fx_hkd_usd

def try_fetch_settlement_pdf(session: requests.Session, sb, period: str) -> tuple:
    """Try to download and parse a Settlement PDF for a period."""
    existing = sb.table("settlement_records").select("period,equity_aud").eq("period", period).execute()
    if existing.data and existing.data[0].get("equity_aud") is not None:
        log.info(f"Settlement PDF {period} already exists, skip")
        return False, None

    url = f"https://metro.dttw.com/metro/zh-hant/download-past-settlement-pdf/1232/{period}"
    log.info(f"Try settlement PDF: {period} ...")
    try:
        resp = session.get(url, timeout=30, allow_redirects=False)
    except Exception as e:
        log.warning(f"PDF request failed: {e}")
        return False, None

    if resp.status_code != 200:
        log.info(f"PDF {period} not available (HTTP {resp.status_code})")
        return False, None
    if "pdf" not in resp.headers.get("Content-Type", "").lower():
        log.info(f"PDF {period} not available (non-PDF response)")
        return False, None

    log.info(f"PDF {period} downloaded ({len(resp.content)//1024} KB), parsing...")
    parsed = parse_settlement_pdf(resp.content)
    if not parsed or parsed.get("equity_aud") is None:
        log.error(f"PDF {period} parse failed or empty")
        return False, None

    parsed["period"] = period

    # 鍐欏叆 settlement_records
    try:
        sb.table("settlement_records").upsert(parsed, on_conflict="period").execute()
        log.info(f"Settlement {period} saved to settlement_records")
    except Exception as e:
        log.error(f"failed to write settlement_records: {e}")
        return False, None

    # 鎺ㄧ畻骞舵洿鏂版眹鐜?
    fx_aud, fx_hkd = derive_fx_rates(parsed)
    if fx_aud or fx_hkd:
        fee_payload = {"period": period}
        if fx_aud: fee_payload["fx_aud_usd"] = round(fx_aud, 8)
        if fx_hkd: fee_payload["fx_hkd_usd"] = round(fx_hkd, 8)
        try:
            sb.table("period_fees").upsert(fee_payload, on_conflict="period").execute()
            log.info(f"FX2 synced AUD/USD={fx_aud:.6f} HKD/USD={fx_hkd:.6f}")
        except Exception as e:
            log.error(f"failed to update period_fees: {e}")

    return True, parsed


# 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲
#  鈶?IMAP 閭欢鐩戝惉 + 鏈堝害涓氱哗鏍稿
# 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲

def check_settlement_emails() -> list:
    """
    妫€鏌?QQ 閭涓?DTTW 鐨勭粨绠楅€氱煡閭欢銆?    杩斿洖灏氭湭澶勭悊鐨勭粨绠楁湀浠藉垪琛紝濡?['2026-04', '2026-05']銆?    璇嗗埆鏉′欢锛?      鍙戜欢浜猴細noreply@metro.dttw.com
      涓婚鍚細Settlements for {Month}, {Year} have been published
    """
    if not IMAP_HOST or not SMTP_USER or not SMTP_PASS:
        log.warning("IMAP not configured, skip email check")
        return []

    periods = []
    try:
        mail = imaplib.IMAP4_SSL(IMAP_HOST, IMAP_PORT)
        mail.login(SMTP_USER, SMTP_PASS)
        mail.select("INBOX")

        # 鎼滅储鏈€杩?90 澶╁唴鐨?DTTW 缁撶畻閭欢
        since_date = (date.today() - timedelta(days=90)).strftime("%d-%b-%Y")
        _, msgs = mail.search(None,
            f'(FROM "noreply@metro.dttw.com" SINCE "{since_date}")')

        for msg_id in (msgs[0].split() if msgs[0] else []):
            try:
                _, data = mail.fetch(msg_id, "(RFC822)")
                msg = email_lib.message_from_bytes(data[0][1])

                raw_subj = decode_header(msg["Subject"])[0][0]
                subject = raw_subj.decode("utf-8", errors="ignore") if isinstance(raw_subj, bytes) else str(raw_subj)

                m = re.search(
                    r'Settlements for (\w+),?\s+(\d{4})\s+have been published',
                    subject, re.IGNORECASE)
                if not m:
                    continue

                try:
                    month_num = datetime.strptime(m.group(1), "%B").month
                    year      = int(m.group(2))
                    period    = f"{year}-{month_num:02d}"
                    periods.append(period)
                    log.info(f"settlement email found: {subject} -> period={period}")
                except ValueError:
                    log.warning(f"cannot parse settlement month: {subject}")
            except Exception as e:
                log.warning(f"failed to process email: {e}")

        mail.close()
        mail.logout()
    except Exception as e:
        log.error(f"IMAP connection failed ({IMAP_HOST}:{IMAP_PORT}): {e}")

    return list(set(periods))   # 鍘婚噸


def monthly_csv_and_reconcile(session: requests.Session, sb, period: str) -> dict:
    """Fetch monthly CSV, compare with daily_performance, and write discrepancy_note."""
    existing = sb.table("trade_records").select("trader_id,source_file").eq("period", period).execute()
    already_done = {r["trader_id"] for r in (existing.data or [])
                    if (r.get("source_file") or "").startswith("auto-monthly-")}
    if len(already_done) == len(TRADER_CSV_BASES):
        log.info(f"{period} monthly reconcile already done, skip")
        return {}

    log.info(f"start monthly CSV fetch: {period}")
    summary = {}

    for trader_id in TRADER_CSV_BASES:
        if trader_id in already_done:
            log.info(f"  {trader_id} already processed, skip")
            continue

        rows = fetch_monthly_csv(session, trader_id, period)
        if not rows:
            log.warning(f"  {trader_id} monthly CSV has no rows")
            continue

        gross   = sum(r["gross"]          for r in rows)
        gateway = sum(r["gateway_charge"] for r in rows)
        sec_fee = sum(r["sec_fee"]        for r in rows)
        exe_fee = sum(r["exe_fee"]        for r in rows)
        net_csv = gross - gateway
        ccy     = rows[0]["currency"]

        # 涓?daily_performance 鏈堝害绱瀵规瘮
        dp = sb.table("daily_performance") \
               .select("trading_total") \
               .eq("trader_name", trader_id) \
               .like("trade_date", f"{period}%") \
               .execute().data or []
        net_daily = sum(float(r.get("trading_total") or 0) for r in dp)

        diff = net_csv - net_daily
        note = None
        if abs(diff) > 0.01:
            note = (f"monthly CSV vs daily MTD diff {diff:+.4f} {ccy}"
                    f" (monthly={net_csv:.4f}, daily={net_daily:.4f})")
            log.warning(f"  {trader_id} discrepancy: {note}")
        else:
            log.info(f"  {trader_id} reconcile OK (diff={diff:.4f})")

        summary[trader_id] = {"diff": diff, "note": note, "ccy": ccy}

        sb.table("trade_records").upsert({
            "trader_id":        trader_id,
            "period":           period,
            "gross":            round(gross,   4),
            "gateway_charge":   round(gateway, 4),
            "sec_fee":          round(sec_fee, 4),
            "exe_fee":          round(exe_fee, 4),
            "ccy":              ccy,
            "source_file":      f"auto-monthly-{period}",
            "discrepancy_note": note,
        }, on_conflict="trader_id,period").execute()

    return summary


# 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲
#  Supabase 鍐欏叆
# 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲

def upsert_daily_rows(sb, rows: list):
    if not rows:
        return
    for row in rows:
        row["is_confirmed"] = False
    sb.table("daily_performance").upsert(rows, on_conflict="trade_date,trader_name").execute()
    log.info(f"upserted {len(rows)} daily rows")


# 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲
#  閭欢閫氱煡
# 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲

def send_email(subject: str, html_body: str):
    if not SMTP_HOST or not SMTP_USER or not NOTIFY_EMAIL:
        log.warning("email config incomplete, skip")
        return
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"]    = SMTP_USER
        msg["To"]      = NOTIFY_EMAIL
        msg.attach(MIMEText(html_body, "html", "utf-8"))
        ctx = ssl.create_default_context()
        if SMTP_PORT == 465:
            with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, context=ctx, timeout=20) as s:
                s.login(SMTP_USER, SMTP_PASS)
                s.sendmail(SMTP_USER, NOTIFY_EMAIL, msg.as_string())
        else:
            with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=20) as s:
                s.ehlo(); s.starttls(context=ctx); s.login(SMTP_USER, SMTP_PASS)
                s.sendmail(SMTP_USER, NOTIFY_EMAIL, msg.as_string())
        log.info(f"email sent to {NOTIFY_EMAIL}")
    except Exception as e:
        log.error(f"email send failed: {e}")


def build_email(target: date, daily_results: dict, daily_errors: list,
                monthly: dict, pdf_result: dict, reconcile: dict,
                balances: dict = None, proj_balances: dict = None) -> tuple:
    run_time = datetime.now().strftime("%Y-%m-%d %H:%M")
    GREEN = "#22c55e"; RED = "#ef4444"; GRAY = "#6b7280"; WARN = "#f59e0b"; BLUE = "#3b82f6"
    BG = "#f9fafb"; CARD = "#ffffff"
    balances = balances or {}
    proj_balances = proj_balances or {}

    has_errors = bool(daily_errors) or any(r.get("note") for r in reconcile.values())
    needs_margin_deposit = any(
        proj is not None and proj < TRADER_RESERVE_USD.get(tid, 0)
        for tid, proj in proj_balances.items()
    )
    subject = f"[DTTW] {'异常' if has_errors else '业绩抓取完成'} {target}"
    if needs_margin_deposit:
        subject = f"❗ {subject}"

    trader_rows = ""
    TD = "padding:7px 10px;white-space:nowrap"
    for tid, rows in daily_results.items():
        name = TRADER_NAMES.get(tid, tid)
        mtd = (monthly or {}).get(tid)
        mtd_c = f'{("+" if mtd >= 0 else "")}{mtd:.2f}' if mtd is not None else "-"
        mc = GREEN if mtd is not None and mtd >= 0 else (RED if mtd is not None else GRAY)
        proj = proj_balances.get(tid)
        pc = f'${proj:,.2f}' if proj is not None else "-"
        reserve = TRADER_RESERVE_USD.get(tid, 0)
        needs_deposit = proj is not None and proj < reserve
        bc = RED if needs_deposit else (BLUE if proj is not None and proj >= reserve else WARN)
        alert = " ❗" if needs_deposit else ""
        if not rows:
            trader_rows += f'<tr><td style="{TD};font-weight:600">{name}{alert}</td><td style="{TD};color:{GRAY}">-</td><td style="{TD};color:{GRAY}">Non-trading</td><td style="{TD};font-weight:700;color:{mc}">{mtd_c}</td><td style="{TD};font-weight:700;color:{bc}">{pc}</td></tr>'
        else:
            net = sum(r["trading_total"] for r in rows)
            ccy = rows[0].get("currency", "")
            nc = GREEN if net >= 0 else RED
            trader_rows += f'<tr><td style="{TD};font-weight:600">{name}{alert}</td><td style="{TD};color:{GRAY}">{ccy}</td><td style="{TD};font-weight:700;color:{nc}">{"+" if net>=0 else ""}{net:.2f}</td><td style="{TD};font-weight:700;color:{mc}">{mtd_c}</td><td style="{TD};font-weight:700;color:{bc}">{pc}</td></tr>'

    pdf_block = ""
    if pdf_result:
        p, ok = pdf_result.get("period", ""), pdf_result.get("success", False)
        pdf_text = "parsed and saved" if ok else "not available yet"
        pdf_block = f'<div style="margin:16px 0;padding:12px 16px;background:{"#f0fdf4" if ok else "#fff7ed"};border-radius:8px;border-left:4px solid {"#22c55e" if ok else "#f59e0b"}"><b>Settlement PDF {p}</b>: {pdf_text}</div>'

    reconcile_block = ""
    if reconcile:
        items = ""
        for tid, info in reconcile.items():
            name = TRADER_NAMES.get(tid, tid)
            color = WARN if info.get("note") else GREEN
            label = info.get("note") or f"OK (diff={info['diff']:.4f})"
            items += f'<li style="color:{color}">{name}: {label}</li>'
        reconcile_block = f'<div style="margin:16px 0;padding:12px 16px;background:#f8fafc;border-radius:8px;border-left:4px solid #3b82f6"><b>Monthly reconcile</b><ul style="margin:8px 0;padding-left:18px;font-size:13px">{items}</ul></div>'

    err_block = ""
    if daily_errors:
        items = "".join(f"<li>{e}</li>" for e in daily_errors)
        err_block = f'<div style="margin:16px 0;padding:12px 16px;background:#fef2f2;border-radius:8px;border-left:4px solid {RED}"><b style="color:{RED}">异常</b><ul style="margin:8px 0;padding-left:18px;font-size:13px">{items}</ul></div>'

    TH = f'padding:5px 10px;text-align:left;color:{GRAY};font-size:12px;white-space:nowrap'
    html = f"""<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:{BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:620px;margin:32px auto;background:{CARD};border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08)">
    <div style="background:#1e293b;padding:20px 28px">
      <div style="font-size:20px;font-weight:800;color:#fff">DTTW 每日报告</div>
      <div style="font-size:13px;color:#94a3b8;margin-top:4px">{target.strftime("%Y-%m-%d")} · {run_time}</div>
    </div>
    <div style="padding:20px 24px">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="border-bottom:2px solid #e5e7eb">
          <th style="{TH}">交易员</th><th style="{TH}">CCY</th><th style="{TH}">当日</th><th style="{TH}">月累计</th><th style="{TH}">预估余额 USD</th>
        </tr></thead>
        <tbody style="border-bottom:1px solid #e5e7eb">{trader_rows}</tbody>
      </table>
      {pdf_block}{reconcile_block}{err_block}
    </div>
    <div style="padding:14px 28px;font-size:12px;color:{GRAY};border-top:1px solid #f1f5f9">数据已同步至 Supabase · 每天 20:00 自动运行</div>
  </div>
</body></html>"""
    return subject, html

def main():
    target = date.today() - timedelta(days=1)   # 鏄ㄦ棩
    prev_month = (date.today().replace(day=1) - timedelta(days=1)).strftime("%Y-%m")  # 涓婃湀

    log.info("=" * 60)
    log.info(f"run_date={date.today()} target={target}")
    log.info(f"prev_month={prev_month}")

    sb      = create_client(SUPABASE_URL, SUPABASE_KEY)
    session = load_session()
    errors  = []
    daily_results = {tid: [] for tid in TRADER_CSV_BASES}
    pdf_result    = {}
    reconcile     = {}

    if not is_logged_in(session):
        log.info("cookies expired, trying to refresh...")
        if not refresh_from_browser(session):
            msg = "DTTW login failed; please login in Edge/Chrome and export cookies again"
            log.error(msg); errors.append(msg)
            send_email("[DTTW] login failed", f"<p>{msg}</p>")
            return

    log.info("--- Daily performance fetch ---")
    all_daily_rows = []
    for trader_id in TRADER_CSV_BASES:
        rows = fetch_daily_csv(session, trader_id, target)
        if rows is None:
            if not refresh_from_browser(session):
                errors.append(f"{trader_id} cookies expired and refresh failed"); continue
            rows = fetch_daily_csv(session, trader_id, target) or []
        daily_results[trader_id] = rows
        all_daily_rows.extend(rows)

    if all_daily_rows:
        upsert_daily_rows(sb, all_daily_rows)
    else:
        log.info("no daily rows, possibly non-trading day")

    month_start = target.replace(day=1).isoformat()
    monthly_mtd = {}
    monthly_mtd_detail = {}
    try:
        mtd_rows = sb.table("daily_performance").select("trader_name,trading_total,exe_fee") \
            .gte("trade_date", month_start).execute().data or []
        for r in mtd_rows:
            tid = r["trader_name"]
            net = float(r.get("trading_total") or 0)
            exe = float(r.get("exe_fee") or 0)
            monthly_mtd[tid] = monthly_mtd.get(tid, 0) + net
            d = monthly_mtd_detail.get(tid, {"net": 0.0, "exe": 0.0})
            d["net"] += net
            d["exe"] += exe
            monthly_mtd_detail[tid] = d
    except Exception as e:
        log.warning(f"monthly MTD query failed: {e}")

    log.info("--- Settlement PDF fetch ---")
    ok, parsed = try_fetch_settlement_pdf(session, sb, prev_month)
    pdf_result = {"period": prev_month, "success": ok, "parsed": parsed}

    log.info("--- Settlement email check ---")
    settlement_periods = check_settlement_emails()
    if settlement_periods:
        log.info(f"settlement periods found: {settlement_periods}")
        for period in settlement_periods:
            log.info(f"monthly reconcile: {period}")
            rec = monthly_csv_and_reconcile(session, sb, period)
            reconcile.update(rec)
    else:
        log.info("no new settlement email")

    balances = {}
    proj_balances = {}
    try:
        bal_rows = sb.table("margin_balances").select("*").execute().data or []
        balances = {r["trader_id"]: r for r in bal_rows}

        # Previous and current month MTD for projected margin balance.
        prev_month_str = prev_month
        cur_month_str  = target.strftime("%Y-%m")
        prev_start = f"{prev_month_str}-01"
        prev_end   = (date.fromisoformat(prev_start).replace(day=1) + timedelta(days=32)).replace(day=1).isoformat()
        prev_mtd_rows  = sb.table("daily_performance").select("trader_name,trading_total,exe_fee") \
                           .gte("trade_date", prev_start).lt("trade_date", prev_end).execute().data or []
        prev_mtd: dict = {}
        for r in prev_mtd_rows:
            tid = r["trader_name"]
            d = prev_mtd.get(tid, {"net": 0.0, "exe": 0.0})
            d["net"] += float(r.get("trading_total") or 0)
            d["exe"] += float(r.get("exe_fee") or 0)
            prev_mtd[tid] = d

        fx_rows = sb.table("period_fees").select("period,asx_aud,chixa_usd,hke_hkd,fx_aud_usd,fx_hkd_usd") \
                    .execute().data or []
        fx_rows = sorted(fx_rows, key=lambda r: r["period"], reverse=True)
        confirmed_rows = sb.table("commission_results").select("trader_id,period") \
                           .eq("status", "confirmed") \
                           .in_("period", [prev_month_str, cur_month_str]).execute().data or []
        confirmed_set = {(r["trader_id"], r["period"]) for r in confirmed_rows}

        def get_period_fee(period, ccy):
            key = "fx_hkd_usd" if ccy == "HKD" else "fx_aud_usd"
            return next(
                (r for r in fx_rows if r["period"] <= period and float(r.get(key) or 0) > 0),
                None,
            )

        def comm_est(net, exe, ccy, pf):
            if not pf:
                return 0
            if ccy == "HKD":
                fx = float(pf.get("fx_hkd_usd") or 0)
                hke = float(pf.get("hke_hkd") or 451.70)
                return (net - exe - hke) * fx if fx > 0 else 0
            fx = float(pf.get("fx_aud_usd") or 0)
            if fx <= 0:
                return 0
            asx = float(pf.get("asx_aud") or 264.44) / 2
            chixa = float(pf.get("chixa_usd") or 129.0) / 2
            return (net * 0.80 - exe - asx - chixa / fx) * fx - 75

        log.info(f"margin_balances: {list(balances.keys())}")
        log.info(f"period_fees periods: {[r['period'] for r in fx_rows]}  confirmed: {confirmed_set}")
        for tid in TRADER_CSV_BASES:
            ccy = TRADER_CCY.get(tid, "AUD")
            bal = float((balances.get(tid) or {}).get("balance_usd") or 0)
            pending = 0
            for month, mtd_map in [(prev_month_str, prev_mtd), (cur_month_str, monthly_mtd_detail)]:
                if (tid, month) in confirmed_set:
                    continue
                mtd = mtd_map.get(tid, {"net": 0.0, "exe": 0.0})
                pf = get_period_fee(month, ccy)
                est = comm_est(mtd["net"], mtd["exe"], ccy, pf)
                pending += est
                pf_period = pf.get("period") if pf else "none"
                log.info(
                    f"    {tid} {month}: net={mtd['net']:.4f} exe={mtd['exe']:.4f} "
                    f"fx_period={pf_period} est={est:.2f}"
                )
            proj_balances[tid] = round(bal + pending, 2)
            log.info(f"  {tid}: bal={bal:.2f}  pending={pending:.2f}  proj={proj_balances[tid]:.2f}")
    except Exception as e:
        log.error(f"balance/projection query failed: {e}", exc_info=True)

    log.info("--- Send report email ---")
    subject, html = build_email(target, daily_results, errors, monthly_mtd, pdf_result, reconcile, balances, proj_balances)
    send_email(subject, html)
    log.info("done")


if __name__ == "__main__":
    main()

