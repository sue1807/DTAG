#!/usr/bin/env python3
"""
fetch_server.py — 本地常驻 HTTP 服务

端口：18765

功能：
- /fetch              数据抓取
- /fetch-settlement   PDF结算解析
- /ocr                图片OCR（PaddleOCR）

【手动启动】
  python scripts/fetch_server.py
"""

import sys
import os
import json
import logging
import re
import io
import base64
import signal
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fetch_performance import (
    load_session, is_logged_in, refresh_from_browser,
    fetch_daily_csv, upsert_daily_rows,
    parse_settlement_pdf,
    TRADER_CSV_BASES, SUPABASE_URL, SUPABASE_KEY,
)
from supabase import create_client

_DIR = os.path.dirname(os.path.abspath(__file__))
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    handlers=[
        logging.FileHandler(os.path.join(_DIR, "fetch_server.log"), encoding="utf-8"),
        logging.StreamHandler(),
    ],
)
log = logging.getLogger(__name__)

PORT = 18765

# =========================
# OCR ENGINE（全局单例）
# =========================
import easyocr
from PIL import Image

OCR_ENGINE = easyocr.Reader(['en'], gpu=False)
log.info("EasyOCR engine initialized")


# =========================
# OCR FUNCTION（优化版）
# =========================
def ocr_settlement_image(image_data):
    """用 EasyOCR 识别 Settlement 截图中的表格数据"""
    try:
        import tempfile
        from PIL import ImageEnhance

        img = Image.open(io.BytesIO(image_data))

        # 图像增强：提高对比度和锐度，改善 OCR 识别精度
        enhancer = ImageEnhance.Contrast(img)
        img = enhancer.enhance(1.5)
        enhancer = ImageEnhance.Sharpness(img)
        img = enhancer.enhance(2.0)

        with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as tmp:
            img.save(tmp.name)
            tmp_path = tmp.name

        try:
            result = OCR_ENGINE.readtext(tmp_path)

            # 结构化处理 OCR 结果 (EasyOCR 格式)
            text_lines = []
            if result:
                for detection in result:
                    text_lines.append(detection[1])  # 提取文本

            text = "\n".join(text_lines)
            log.info(f"OCR 识别完成，文本长度: {len(text)}")

        finally:
            os.unlink(tmp_path)

        def parse_num(s):
            try:
                return float(s.replace(",", ""))
            except:
                return None

        result_data = {}

        # ===== 1. SETTLEMENT 部分 (AUD, HKD) =====
        # Equity - 两个数字（AUD 在前，HKD 在后）
        match = re.search(r"Equity\n([\d,]+\.?\d*)\n([\d,]+\.?\d*)", text)
        if match:
            result_data["equity_aud"] = parse_num(match.group(1))
            result_data["equity_hkd"] = parse_num(match.group(2))

        # Cut for Equity - 两个数字（AUD, HKD）
        match = re.search(r"Cut\s+for\s+Equity\n([\d,]+\.?\d*)\n([\d,]+\.?\d*)", text)
        if match:
            result_data["cut_aud"] = parse_num(match.group(1))
            result_data["cut_hkd"] = parse_num(match.group(2))

        # Net for Equity - 两个数字（AUD, HKD）
        match = re.search(r"Net\s+for\s+Equity\n([\d,]+\.?\d*)\n([\d,]+\.?\d*)", text)
        if match:
            result_data["net_aud"] = parse_num(match.group(1))
            result_data["net_hkd"] = parse_num(match.group(2))

        # ===== 2. ADJUSTMENT 部分 (AUD/HKD/USD，用坐标判断币种列) =====
        # Adjustments SUB TOTAL 的数值每月可能落在不同币种列（如 4月在 USD、5月在 AUD），
        # 所以不能假设第一个数字=AUD；改用每个文本块的横向坐标与 AUD/HKD/USD 表头对齐判断列。
        def _cx(bbox):
            xs = [float(p[0]) for p in bbox]
            return sum(xs) / len(xs)

        def _cy(bbox):
            ys = [float(p[1]) for p in bbox]
            return sum(ys) / len(ys)

        # 表头列锚点：取首次出现的 AUD/HKD/USD 的 x 中心
        col_x = {}
        for bbox, txt, _conf in result:
            t = txt.strip().upper()
            if t in ("AUD", "HKD", "USD") and t not in col_x:
                col_x[t] = _cx(bbox)

        # 定位 Adjustments 区块的 y 范围（Adjustments 标题 → Expenses 标题之间）
        adj_y = exp_y = None
        for bbox, txt, _conf in result:
            t = txt.strip().lower()
            if adj_y is None and t.startswith("adjust"):
                adj_y = _cy(bbox)
            if exp_y is None and t.startswith("expense"):
                exp_y = _cy(bbox)

        # 在该区块内找 SUB TOTAL 行的 y（记录文字高度用于自适应容差）
        sub_y, sub_h = None, 0.0
        if adj_y is not None:
            for bbox, txt, _conf in result:
                t = txt.strip().upper().replace(" ", "")
                y = _cy(bbox)
                if t.startswith("SUBTOTAL") and y > adj_y and (exp_y is None or y < exp_y):
                    sub_y = y
                    ys = [float(p[1]) for p in bbox]
                    sub_h = max(ys) - min(ys)
                    break

        # 在 SUB TOTAL 同一行找数字，按 x 对齐最近的币种列
        if sub_y is not None and col_x:
            tol = max(12.0, sub_h * 0.8)
            for bbox, txt, _conf in result:
                val = parse_num(txt.strip())
                if val is None:
                    continue
                if abs(_cy(bbox) - sub_y) <= tol:
                    col = min(col_x, key=lambda c: abs(col_x[c] - _cx(bbox)))
                    result_data["adjustment_sub_total_" + col.lower()] = val
                    log.info(f"Adjustment SUB TOTAL: {val} → {col} 列")

        # ===== 3. EXPENSES 部分 - Total Transaction Fees (AUD, HKD, USD) =====
        match = re.search(r"Total\s+Transaction\s+Fees?\n([-\d,]+\.?\d*)\n([-\d,]+\.?\d*)(?:\n([-\d,]+\.?\d*))?", text, re.IGNORECASE)
        if match:
            result_data["exe_aud"] = parse_num(match.group(1))
            result_data["exe_hkd"] = parse_num(match.group(2))
            if match.group(3):
                result_data["exe_usd"] = parse_num(match.group(3))

        # ===== 4. GRAND TOTAL 部分 (已正确) =====
        # Post Exchange Total (AUD, HKD, USD)
        match = re.search(r"Post[\s\S]*?Exchange[\s\S]*?\n([-\d,]+\.?\d*)\n([-\d,]+\.?\d*)\n([-\d,]+\.?\d*)", text, re.IGNORECASE)
        if match:
            result_data["post_exchange_usd"] = parse_num(match.group(3))

        return {
            "success": len(result_data) > 0,
            "data": result_data,
            "raw_text": text
        }

    except ImportError as e:
        return {
            "success": False,
            "error": "缺少 PaddleOCR 或 PIL。请运行: pip install paddleocr pillow",
            "data": None
        }
    except Exception as e:
        log.error(f"OCR 处理错误: {e}", exc_info=True)
        return {"success": False, "error": str(e), "data": None}


# =========================
# HTTP SERVER
# =========================
class FetchHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        log.info("HTTP " + fmt % args)

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    # =========================
    # POST
    # =========================
    def do_POST(self):
        try:
            log.info(f"POST path: {self.path}")
            parsed = urlparse(self.path)

            if parsed.path == "/ocr":
                self._handle_ocr()
                return

            self._json(404, {"error": "not found"})

        except Exception as e:
            self._json(500, {"error": str(e)})

    # =========================
    # OCR API
    # =========================
    def _handle_ocr(self):
        try:
            content_length = int(self.headers.get("Content-Length", 0))

            body = self.rfile.read(content_length)
            content_type = self.headers.get("Content-Type", "")

            if "application/json" in content_type:
                data = json.loads(body.decode("utf-8"))
                base64_str = data.get("image")

                if not base64_str:
                    self._json(400, {"error": "missing image"})
                    return

                if base64_str.startswith("data:"):
                    base64_str = base64_str.split(",", 1)[1]

                image_data = base64.b64decode(base64_str)

                log.info(f"OCR request size: {len(image_data)} bytes")

                result = ocr_settlement_image(image_data)
                self._json(200, result)
                return

            self._json(400, {"error": "unsupported content type"})

        except Exception as e:
            log.error(f"OCR error: {e}", exc_info=True)
            self._json(500, {"error": str(e)})

    # =========================
    # GET
    # =========================
    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)

        if parsed.path == "/fetch-settlement":
            self._handle_settlement(params)
            return

        if parsed.path != "/fetch":
            self._json(404, {"error": "not found"})
            return

        try:
            date_from = date.fromisoformat(params["from"][0])
            date_to   = date.fromisoformat(params["to"][0])
        except (KeyError, ValueError) as e:
            self._json(400, {"error": f"日期参数错误: {e}"}); return

        log.info(f"收到抓取请求: {date_from} → {date_to}")
        try:
            sb      = create_client(SUPABASE_URL, SUPABASE_KEY)
            session = load_session()

            if not is_logged_in(session):
                log.info("Session 失效，尝试刷新...")
                if not refresh_from_browser(session):
                    self._json(503, {"error": "DTTW 登录失败，请在浏览器登录 Metro 后重新导出 cookies"}); return

            all_rows = []
            d = date_from
            while d <= date_to:
                if d.weekday() < 5:   # 跳过周末
                    for trader_id in TRADER_CSV_BASES:
                        rows = fetch_daily_csv(session, trader_id, d)
                        if rows is None:
                            if refresh_from_browser(session):
                                rows = fetch_daily_csv(session, trader_id, d) or []
                            else:
                                log.warning(f"{trader_id} {d} session 失效，跳过"); continue
                        all_rows.extend(rows)
                d += timedelta(days=1)

            if all_rows:
                upsert_daily_rows(sb, all_rows)

            msg = f"完成，写入 {len(all_rows)} 条" if all_rows else "无数据（均为非交易日或无成交）"
            log.info(msg)
            self._json(200, {"message": msg, "rows": len(all_rows)})

        except Exception as e:
            log.error(f"抓取出错: {e}", exc_info=True)
            self._json(500, {"error": str(e)})

    def _handle_settlement(self, params):
        period = (params.get("period") or [None])[0]
        if not period:
            self._json(400, {"error": "缺少 period 参数，格式 YYYY-MM"}); return
        log.info(f"抓取 Settlement PDF: {period}")
        try:
            session = load_session()
            if not is_logged_in(session):
                if not refresh_from_browser(session):
                    self._json(503, {"error": "DTTW 登录失败，请重新导出 cookies"}); return
            url = f"https://metro.dttw.com/metro/zh-hant/download-past-settlement-pdf/1232/{period}"
            resp = session.get(url, timeout=30)
            if resp.status_code != 200:
                self._json(400, {"error": f"PDF 下载失败 HTTP {resp.status_code}，该月份可能尚未结算"}); return
            if b"%PDF" not in resp.content[:10]:
                self._json(400, {"error": "返回内容不是 PDF，请确认该月份已完成结算"}); return
            parsed = parse_settlement_pdf(resp.content)
            if not parsed:
                self._json(500, {"error": "PDF 解析失败，请改用手动上传"}); return
            log.info(f"PDF 解析完成: {period}")
            self._json(200, {"message": f"{period} PDF 解析成功", "parsed": parsed})
        except Exception as e:
            log.error(f"Settlement 抓取出错: {e}", exc_info=True)
            self._json(500, {"error": str(e)})

    # =========================
    # response
    # =========================
    def _json(self, code, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


# =========================
# main
# =========================
if __name__ == "__main__":
    log.info(f"本地抓取服务启动，端口 {PORT}  Ctrl+C 退出")
    server = HTTPServer(("localhost", PORT), FetchHandler)

    def signal_handler(signum, frame):
        log.info("收到关闭信号，服务停止")
        server.shutdown()
        sys.exit(0)

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("服务已停止")
