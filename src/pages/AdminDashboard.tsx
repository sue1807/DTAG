// frontend/src/pages/AdminDashboard.tsx
import { useState, useEffect, useRef } from "react";
import { supabase, db, callFunction, callFunctionForm } from "../lib/supabase";

// ── Static trader config ─────────────────────────────────────
const TRADERS: Record<string, { name: string; ccy: string; markets: string; since: string; reserve: number }> = {
  HONG045: { name: "王博",   ccy: "AUD", markets: "ASX · CHIXA", since: "2025-08-01", reserve: 1000 },
  PENGCDU: { name: "马金斗", ccy: "AUD", markets: "ASX · CHIXA", since: "2025-06-02", reserve: 1000 },
  LULUSHI: { name: "石路路", ccy: "HKD", markets: "HKE",         since: "2024-01-08", reserve: 500  },
};

const f2 = (n: number) =>
  Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const toNum = (s: string) => parseFloat(s?.replace(/,/g, "") || "0") || 0;

// 从 payment_exchange 提取汇率2；如有 HKD→USD 缺失但有 AUD→HKD loss_coverage，可推算 fx_hkd_usd
// 注意：loss_coverage 里的 AUD→USD 是汇率1，不用于此处
function deriveFxRates(lc: any[], pe: any[]): { fxAudUsd: number; fxHkdUsd: number } {
  const peAudUsd = pe?.find((r: any) => r.from_ccy === "AUD" && r.to_ccy === "USD");
  const peHkdUsd = pe?.find((r: any) => r.from_ccy === "HKD" && r.to_ccy === "USD");
  const lcAudHkd = lc?.find((r: any) => r.from_ccy === "AUD" && r.to_ccy === "HKD");

  const fxAudUsd = peAudUsd ? parseFloat(peAudUsd.rate) : 0;
  // fx_hkd_usd: 优先 payment_exchange 直接值；其次若有 payment_exchange 的 AUD/USD + loss_coverage 的 AUD/HKD 则推算
  const fxHkdUsd = peHkdUsd ? parseFloat(peHkdUsd.rate)
                 : (lcAudHkd && fxAudUsd) ? lcAudHkd.rate * fxAudUsd
                 : 0;
  return { fxAudUsd, fxHkdUsd };
}

const hasPaymentExchange = (pe: any[] | undefined | null) => Array.isArray(pe) && pe.length > 0;

const peNum = (value: any) => {
  const n = parseFloat(value);
  return Number.isFinite(n) ? Number(n.toFixed(8)) : 0;
};

function normalizePaymentExchange(pe: any[] | undefined | null): string {
  return JSON.stringify((pe ?? []).map((r: any) => ({
    from_ccy: r.from_ccy ?? "",
    to_ccy: r.to_ccy ?? "",
    from_amount: peNum(r.from_amount),
    to_amount: peNum(r.to_amount),
    rate: peNum(r.rate),
  })).sort((a: any, b: any) =>
    `${a.from_ccy}-${a.to_ccy}-${a.from_amount}`.localeCompare(`${b.from_ccy}-${b.to_ccy}-${b.from_amount}`)
  ));
}

function paymentExchangeDiffers(current: any[] | undefined | null, parsed: any[] | undefined | null): boolean {
  return hasPaymentExchange(current) && hasPaymentExchange(parsed) && normalizePaymentExchange(current) !== normalizePaymentExchange(parsed);
}

function derivePaymentExchangeFx(pe: any[] | undefined | null): { fxAudUsd: number; fxHkdUsd: number } {
  const peAudUsd = pe?.find((r: any) => r.from_ccy === "AUD" && r.to_ccy === "USD");
  const peHkdUsd = pe?.find((r: any) => r.from_ccy === "HKD" && r.to_ccy === "USD");
  return {
    fxAudUsd: peAudUsd ? parseFloat(peAudUsd.rate) || 0 : 0,
    fxHkdUsd: peHkdUsd ? parseFloat(peHkdUsd.rate) || 0 : 0,
  };
}

// ── PDF Parser ───────────────────────────────────────────────
function normalizePaymentExchangeRates(pe: any[] | undefined | null): any[] {
  if (!Array.isArray(pe)) return [];
  return pe.map((row: any) => {
    const from = toNum(row.from_amount?.toString?.() ?? row.from_amount);
    const to = toNum(row.to_amount?.toString?.() ?? row.to_amount);
    if (from > 0 && to > 0) {
      return { ...row, rate: (to / from).toFixed(8) };
    }
    return row;
  });
}

async function parsePdf(file: File): Promise<any> {
  const pdfjsLib = (window as any).pdfjsLib;
  if (!pdfjsLib) throw new Error("PDF.js not loaded");
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = "";
  let page1Items: { str: string; x: number; y: number }[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    if (i === 1) {
      page1Items = content.items.map((it: any) => ({ str: (it.str || "").trim(), x: it.transform[4], y: it.transform[5] }));
    }
    fullText += content.items.map((item: any) => item.str).join(" ") + "\n";
  }
  const g = (pattern: RegExp) => { const m = fullText.match(pattern); return m ? toNum(m[1]) : null; };
  const equity_aud  = g(/Equity\s+([\d,]+\.?\d*)\s/);
  const cut_aud     = g(/Cut for Equity\s+([\d,]+\.?\d*)\s/);
  const net_aud     = g(/Net for Equity\s+([\d,]+\.?\d*)\s/);
  const equity_hkd  = (() => { const m = fullText.match(/Equity\s+[\d,]+\.?\d*\s+([-\d,]+\.?\d*)/); return m ? toNum(m[1]) : null; })();
  const cut_hkd     = (() => { const m = fullText.match(/Cut for Equity\s+[\d,]+\.?\d*\s+([-\d,]+\.?\d*)/); return m ? toNum(m[1]) : null; })();
  const net_hkd     = (() => { const m = fullText.match(/Net for Equity\s+[\d,]+\.?\d*\s+([-\d,]+\.?\d*)/); return m ? toNum(m[1]) : null; })();
  const txMatch     = fullText.match(/Total Transaction Fees\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)/);
  const exe_aud     = txMatch ? toNum(txMatch[1]) : null;
  const exe_hkd     = txMatch ? toNum(txMatch[2]) : null;
  const petMatch = fullText.match(/Post Exchange Total\s+([-\d,.]+)\s+([-\d,.]+)\s+([-\d,]+\.?\d*)/);
  const post_exchange_aud = petMatch ? toNum(petMatch[1]) : null;
  const post_exchange_hkd = petMatch ? toNum(petMatch[2]) : null;
  const post_exchange_usd = petMatch ? toNum(petMatch[3]) : null;
  const wire_fees_usd     = g(/(?:Last month(?:'s)?\s+\d+\s+wires?|Wire fees?)\s+([\d,]+\.?\d*)/i);
  const loss_coverage: any[] = [];
  const lcSection = fullText.match(/Loss Coverage Currency Exchange([\s\S]*?)(?:Payment Currency Exchange|Powered by|$)/);
  if (lcSection) {
    const lcRegex = /(AUD|HKD|USD)\s+([\d,]+\.?\d*)\s+(AUD|HKD|USD)\s+([-\d,]+\.?\d*)\s+([\d.]+)/g;
    let m; while ((m = lcRegex.exec(lcSection[1])) !== null)
      loss_coverage.push({ from_ccy: m[1], from_amount: toNum(m[2]), to_ccy: m[3], to_amount: toNum(m[4]), rate: parseFloat(m[5]) });
  }
  const payment_exchange: any[] = [];
  const peSection = fullText.match(/Payment Currency Exchange([\s\S]*?)(?:ERP Deposits|Powered by|Entitlements Breakdown|$)/);
  if (peSection) {
    const peRegex = /(AUD|HKD|USD)\s+([\d,]+\.?\d*)\s+(AUD|HKD|USD)\s+([\d,]+\.?\d*)\s+([\d.]+)/g;
    let m; while ((m = peRegex.exec(peSection[1])) !== null)
      payment_exchange.push({ from_ccy: m[1], from_amount: toNum(m[2]), to_ccy: m[3], to_amount: toNum(m[4]), rate: parseFloat(m[5]) });
  }
  const erp_deposits: any[] = [];
  const depSection = fullText.match(/ERP Deposits([\s\S]*?)(?:ERP Withdrawals|Powered by|$)/);
  if (depSection) {
    const depRegex = /(USD|AUD|HKD)\s+([\d,]+\.?\d*)\s+(\d{2}\/\d{2}\/\d{4})/g;
    let m; while ((m = depRegex.exec(depSection[1])) !== null)
      erp_deposits.push({ ccy: m[1], amount: toNum(m[2]), date: m[3] });
  }
  const erp_withdrawals: any[] = [];
  const wdSection = fullText.match(/ERP Withdrawals([\s\S]*?)(?:Powered by|$)/);
  if (wdSection) {
    const wdRegex = /(USD|AUD|HKD)\s+([\d,]+\.?\d*)\s+(\d{2}\/\d{2}\/\d{4})/g;
    let m; while ((m = wdRegex.exec(wdSection[1])) !== null)
      erp_withdrawals.push({ ccy: m[1], amount: toNum(m[2]), date: m[3] });
  }
  // Adjustments SUB TOTAL —— 用坐标判断币种列（列每月可能不同，如 4月USD、5月AUD）
  let adjustment_sub_total_aud: number | null = null;
  let adjustment_sub_total_hkd: number | null = null;
  let adjustment_sub_total_usd: number | null = null;
  (() => {
    // 表头列锚点：首次出现的 AUD/HKD/USD 的 x
    const colX: Record<string, number> = {};
    for (const it of page1Items) {
      const t = it.str.toUpperCase();
      if ((t === "AUD" || t === "HKD" || t === "USD") && !(t in colX)) colX[t] = it.x;
    }
    // Adjustments / Expenses 的 y（pdf.js 坐标 y 向上：往下 y 变小 → expY < subY < adjY）
    let adjY: number | null = null, expY: number | null = null;
    for (const it of page1Items) {
      const t = it.str.toLowerCase();
      if (adjY === null && t.startsWith("adjust")) adjY = it.y;
      if (expY === null && t.startsWith("expense")) expY = it.y;
    }
    if (adjY === null || Object.keys(colX).length === 0) return;
    // 在 Adjustments 和 Expenses 之间找 SUB TOTAL 行的 y
    let subY: number | null = null;
    for (const it of page1Items) {
      if (it.str.toUpperCase().startsWith("SUB") && it.y < adjY && (expY === null || it.y > expY)) { subY = it.y; break; }
    }
    if (subY === null) return;
    // 同一行的数字，按 x 对齐最近的币种列
    for (const it of page1Items) {
      const raw = it.str.trim();
      if (!/^-?[\d,]+\.?\d*$/.test(raw)) continue;   // 只处理纯数字文本
      if (Math.abs(it.y - subY) > 6) continue;        // 同一行
      let best = "", bestD = Infinity;
      for (const c in colX) { const d = Math.abs(colX[c] - it.x); if (d < bestD) { bestD = d; best = c; } }
      const val = toNum(raw);
      if (best === "AUD") adjustment_sub_total_aud = val;
      else if (best === "HKD") adjustment_sub_total_hkd = val;
      else if (best === "USD") adjustment_sub_total_usd = val;
    }
  })();

  return { equity_aud, cut_aud, net_aud, exe_aud, equity_hkd, cut_hkd, net_hkd, exe_hkd, adjustment_sub_total_aud, adjustment_sub_total_hkd, adjustment_sub_total_usd, post_exchange_aud, post_exchange_hkd, post_exchange_usd, wire_fees_usd, loss_coverage, payment_exchange, erp_deposits, erp_withdrawals };
}

// ── Email Notifications Component ────────────────────────────
// ── Component ────────────────────────────────────────────────
export default function AdminDashboard({ onLogout }: { onLogout: () => void }) {
  type Tab = "overview"|"performance"|"settlement"|"payouts"|"config"|"daily"|"readme";
  const [tab, setTab]                 = useState<Tab>("overview");
  const [period, setPeriod]           = useState(() => new Date().toISOString().slice(0, 7));
  const [balances, setBalances]       = useState<any[]>([]);
  const [ledger, setLedger]           = useState<any[]>([]);
  const [tradeRecords, setTradeRecords] = useState<any[]>([]);
  const [settlements, setSettlements] = useState<any[]>([]);
  const [dailyPerf, setDailyPerf]     = useState<any[]>([]);
  const [overviewPerf, setOverviewPerf] = useState<any[]>([]);
  const [dailyPage, setDailyPage]     = useState(0);
  const [dailyDiff, setDailyDiff]     = useState<any>(null);
  const DAILY_PAGE_SIZE = 25;
  const [dailyFilter, setDailyFilter] = useState({
    trader: "All",
    dateFrom: new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10),
    dateTo:   new Date().toISOString().slice(0, 10),
  });
  const [settlView, setSettlView]     = useState<"list"|"edit">("list");
  const [payouts, setPayouts]         = useState<any[]>([]);
  const [commissions, setCommissions]     = useState<any[]>([]);
  const [periodFeesAll, setPeriodFeesAll] = useState<any[]>([]);
  const [calcResult, setCalcResult]       = useState<any>(null);
  const [verify, setVerify]           = useState<any>(null);
  const [preview, setPreview]         = useState<any>(null);
  const [loading, setLoading]         = useState(false);
  const [pdfParsing, setPdfParsing]   = useState(false);
  const [settlImg, setSettlImg]       = useState<string|null>(null);
  const [toast, setToast]             = useState<{ msg: string; ok: boolean } | null>(null);
  const [confirmDlg, setConfirmDlg]   = useState<{ msg: string; onOk: () => void } | null>(null);
  const [tradePage, setTradePage]     = useState(0);
  const TRADE_PAGE_SIZE = 15;
  const [ledgerPage, setLedgerPage]   = useState(0);
  const LEDGER_PAGE_SIZE = 10;
  const [payoutPage, setPayoutPage]   = useState(0);
  const PAYOUT_PAGE_SIZE = 10;
  const [usdReceipts, setUsdReceipts] = useState<any[]>([]);
  const [usdRForm, setUsdRForm]       = useState({ receipt_date: new Date().toISOString().slice(0,10), amount_usd: "", note: "" });
  const [cnyBatchInput, setCnyBatchInput] = useState("");
  const [sessionCnyTotal, setSessionCnyTotal] = useState(0);
  const [sessionUsdTotal, setSessionUsdTotal] = useState(0);
  const [erpLedger, setErpLedger]   = useState<any[]>([]);
  const [erpForm, setErpForm]       = useState({ entry_date: new Date().toISOString().slice(0,10), type: "settlement_deposit", amount_usd: "", settlement_period: "", note: "" });
  const [readme, setReadme] = useState<string>("");
  const dailyUploadRef = useRef<HTMLInputElement>(null);
  const [fetchingDaily, setFetchingDaily] = useState(false);
  const [fetchingSettl, setFetchingSettl] = useState(false);
  const [selectedSettlPeriod, setSelectedSettlPeriod] = useState<string | null>(null);
  const [settling, setSettling] = useState(false);
  const [settlementMatchStatus, setSettlementMatchStatus] = useState<{ match: boolean; differences: string[] } | null>(null);
  const settlPdfRef = useRef<HTMLInputElement>(null);
  const settlImgRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pdfRef  = useRef<HTMLInputElement>(null);

  // Dynamic month list: 2025-11 → today + 8 months
  const MONTHS = (() => {
    const list: string[] = [];
    const d = new Date("2025-11-01");
    const end = new Date(); end.setMonth(end.getMonth() + 8);
    while (d <= end) { list.push(d.toISOString().slice(0,7)); d.setMonth(d.getMonth()+1); }
    return list;
  })();

  const askConfirm = (msg: string, onOk: () => void) => setConfirmDlg({ msg, onOk });


  // Forms
  const [mForm, setMForm] = useState({ trader_id: "HONG045", type: "deposit", amount_usd: "", entry_date: new Date().toISOString().slice(0,10), note: "" });
  const emptySForm = { period, equity_aud:"", cut_aud:"", net_aud:"", exe_aud:"", equity_hkd:"", cut_hkd:"", net_hkd:"", exe_hkd:"", adjustment_sub_total_aud:"", adjustment_sub_total_hkd:"", adjustment_sub_total_usd:"", post_exchange_aud:"", post_exchange_hkd:"", post_exchange_usd:"", wire_fees_usd:"", fx_notes:"", loss_coverage:[] as any[], payment_exchange:[] as any[], erp_deposits:[] as any[], erp_withdrawals:[] as any[] };
  const [sForm, setSForm] = useState<any>(emptySForm);
  const [fForm, setFForm] = useState<any>({ period:"2026-02", asx_aud:"264.44", chixa_usd:"129.00", hke_hkd:"451.70", office_usd:"150.00", wire_usd:"", fx_aud_usd:"", fx_hkd_usd:"" });
  // "pdf"=当期PDF, "derived"=由loss coverage推算, "prev"=沿用上期, ""=手动/未知
  const [fxSrc, setFxSrc] = useState<{ aud: string; hkd: string }>({ aud: "", hkd: "" });
  const emptyPForm = { payout_date: new Date().toISOString().slice(0,10), trader_id:"HONG045", balance_usd:"", reserve_usd:"1000", settle_usd:"", fx_cny:"", cny_amount:"", period_covered:"", bank_account:"", note:"" };
  const [pForm, setPForm] = useState<any>(emptyPForm);
  const emptyPayoutRow = (id = "HONG045") => {
    const cfg = TRADERS[id]; const reserve = cfg?.reserve ?? 0;
    return { trader_id: id, fx_cny: "", period_covered: "", bank_account: "", _reserve: reserve };
  };
  const [payoutDate, setPayoutDate] = useState(new Date().toISOString().slice(0,10));
  const [payoutRows, setPayoutRows] = useState<any[]>([emptyPayoutRow()]);

  const showToast = (msg: string, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };

  const reload = () => {
    db.getBalances().then(r => setBalances(r.data || []));
    db.getLedger().then(r => setLedger(r.data || []));
    supabase.from("settlement_records").select("*").order("period", { ascending: false }).then(r => setSettlements(r.data || []));
    supabase.from("commission_payouts").select("*").order("payout_date", { ascending: false }).then(r => setPayouts(r.data || []));
    supabase.from("trade_records").select("*").order("period", { ascending: false }).then(r => setTradeRecords(r.data || []));
    supabase.from("commission_results").select("*").order("period", { ascending: false }).then(r => setCommissions(r.data || []));
    supabase.from("period_fees").select("*").then(r => setPeriodFeesAll(r.data || []));
    supabase.from("usd_bank_receipts").select("*").order("receipt_date", { ascending: false }).then(r => setUsdReceipts(r.data || []));
    supabase.from("erp_ledger").select("*").order("entry_date", { ascending: false }).then(r => setErpLedger(r.data || []));
    // daily_performance 由 loadDailyData 按月懒加载，不在 reload 里批量拉
  };
  useEffect(() => { reload(); }, []);
  useEffect(() => {
    fetch(import.meta.env.BASE_URL + "README.md").then(r => r.text()).then(setReadme).catch(() => {});
  }, []);

  // 按日期范围加载：月度确认数据（trade_records auto-monthly）优先覆盖当月每日明细，其余月份补全
  const loadDailyData = async (from: string, to: string) => {
    // 1. 计算范围内所有月份
    const months: string[] = [];
    const cur = new Date(from.slice(0, 7) + "-01");
    const endMonth = new Date(to.slice(0, 7) + "-01");
    while (cur <= endMonth) {
      months.push(cur.toISOString().slice(0, 7));
      cur.setMonth(cur.getMonth() + 1);
    }

    // 2. 拉 daily_performance 日数据（始终优先）
    const { data: dpRows } = await supabase.from("daily_performance")
      .select("*").gte("trade_date", from).lte("trade_date", to)
      .order("trade_date", { ascending: false });
    const allDp = dpRows || [];

    // 3. 拉 trade_records，作为无日数据时的兜底（按交易员+月份粒度判断）
    const { data: trAll } = await supabase.from("trade_records")
      .select("*").in("period", months);
    const nameToId = Object.fromEntries(Object.entries(TRADERS).map(([id, v]) => [v.name, id]));
    const dpTraderMonths = new Set(allDp.map((r: any) => {
      const tid = TRADERS[r.trader_name] ? r.trader_name : (nameToId[r.trader_name] ?? r.trader_name);
      return `${tid}:${r.trade_date.slice(0, 7)}`;
    }));
    // 只有该交易员在该月完全没有日数据时，才用 trade_records 合成一行兜底
    const synthetic: any[] = (trAll || [])
      .filter((r: any) => !dpTraderMonths.has(`${r.trader_id}:${r.period}`))
      .map((r: any) => ({
        id:             `tr-${r.id}`,
        trade_date:     `${r.period}-01`,
        trader_name:    r.trader_id,
        currency:       r.ccy,
        gross:          r.gross,
        gateway_charge: r.gateway_charge,
        sec_fee:        r.sec_fee ?? 0,
        act_fee:        r.act_fee ?? 0,
        clr_fee:        r.clr_fee ?? 0,
        exe_fee:        r.exe_fee,
        trading_total:  (r.gross ?? 0) - (r.gateway_charge ?? 0),
        shares_traded:  0,
        trades_made:    0,
        _source:        "trade_records",
        _discrepancy:   r.discrepancy_note ?? null,
      }));

    // 4. 合并并按日期倒序
    const all = [...allDp, ...synthetic]
      .sort((a, b) => b.trade_date.localeCompare(a.trade_date));
    setDailyPerf(all);
    setDailyPage(0);
  };
  useEffect(() => {
    if (tab === "daily") loadDailyData(dailyFilter.dateFrom, dailyFilter.dateTo);
  }, [tab]);

  // 加载 trader 卡片用的概览数据（本月 + 上月），独立于筛选器
  useEffect(() => {
    if (tab !== "daily") return;
    const now = new Date();
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const from = prevMonth.toISOString().slice(0, 7) + "-01";
    const to   = now.toISOString().slice(0, 10);
    supabase.from("daily_performance")
      .select("trader_name,trade_date,trading_total,gross,gateway_charge,exe_fee,currency")
      .gte("trade_date", from).lte("trade_date", to)
      .then(({ data }) => setOverviewPerf(data || []));
  }, [tab]);


  // Load period_fees + existing calc results when period changes
  useEffect(() => {
    supabase.from("period_fees").select("*").eq("period", period).single().then(({ data }) => {
      if (data) {
        setFForm({
          period:     data.period,
          asx_aud:    data.asx_aud?.toString()    ?? "264.44",
          chixa_usd:  data.chixa_usd?.toString()  ?? "129.00",
          hke_hkd:    data.hke_hkd?.toString()    ?? "451.70",
          office_usd: data.office_usd?.toString() ?? "150.00",
          wire_usd:   data.wire_usd?.toString()   ?? "",
          fx_aud_usd: data.fx_aud_usd?.toString() ?? "",
          fx_hkd_usd: data.fx_hkd_usd?.toString() ?? "",
        });
        setFxSrc({ aud: "", hkd: "" }); // loaded from DB, source unknown (manual/prev already saved)
      }
      else {
        // No config for this period — auto-fill rates from last confirmed settlement
        supabase.from("settlement_records")
          .select("period, payment_exchange, loss_coverage")
          .lt("period", period)
          .order("period", { ascending: false })
          .limit(1)
          .single()
          .then(({ data: last }) => {
            const { fxAudUsd, fxHkdUsd } = deriveFxRates(last?.loss_coverage ?? [], last?.payment_exchange ?? []);
            setFForm((f: any) => ({
              ...f, period,
              fx_aud_usd: fxAudUsd ? fxAudUsd.toFixed(8) : "",
              fx_hkd_usd: fxHkdUsd ? fxHkdUsd.toFixed(8) : "",
            }));
            setFxSrc({ aud: fxAudUsd ? "prev" : "", hkd: fxHkdUsd ? "prev" : "" });
          });
      }
    });
    supabase.from("commission_results").select("*").eq("period", period).then(({ data }) => {
      if (data?.length) setCalcResult({ results: data });
      else setCalcResult(null);
    });
    setVerify(null);
    setTradePage(0);
  }, [period]);

  // ── Margin ───────────────────────────────────────────────
  const addMargin = async () => {
    if (!mForm.amount_usd) return;
    setLoading(true);
    try {
      const amt = parseFloat(mForm.amount_usd) * (mForm.type === "deposit" ? 1 : -1);
      const { data: rows } = await supabase.from("margin_ledger").select("amount_usd").eq("trader_id", mForm.trader_id);
      const prevBal = (rows || []).reduce((s: number, e: any) => s + parseFloat(e.amount_usd), 0);
      const { error } = await supabase.from("margin_ledger").insert({
        trader_id: mForm.trader_id, entry_date: mForm.entry_date, type: mForm.type,
        amount_usd: amt, balance_after: prevBal + amt, note: mForm.note, period: "",
      });
      if (error) throw error;
      showToast("已录入"); setMForm(p => ({ ...p, amount_usd: "", note: "" })); reload();
    } catch (e: any) { showToast(e.message, false); }
    setLoading(false);
  };

  // ── CSV Upload ───────────────────────────────────────────
  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    // Check if period is already confirmed - lock upload
    const { data: confirmed } = await supabase.from("commission_results")
      .select("trader_id").eq("period", period).eq("status", "confirmed");
    if (confirmed?.length) {
      showToast(`${period} 提成已确认锁定，无法再次上传 CSV`, false);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setLoading(true);
    try {
      const fd = new FormData(); fd.append("file", file); fd.append("period", period); fd.append("confirm", "false");
      const r = await callFunctionForm("parse-csv", fd);

      // 查 daily_performance 同期数据，生成对比
      const pFrom = `${period}-01`;
      const pNext = new Date(period + "-01"); pNext.setMonth(pNext.getMonth() + 1);
      const pTo   = pNext.toISOString().slice(0, 10);
      const { data: dpRows } = await supabase.from("daily_performance")
        .select("trader_name,gross,gateway_charge,exe_fee,trading_total")
        .gte("trade_date", pFrom).lt("trade_date", pTo);
      const dpAgg: Record<string, any> = {};
      for (const row of dpRows || []) {
        if (!dpAgg[row.trader_name]) dpAgg[row.trader_name] = { gross: 0, gateway_charge: 0, exe_fee: 0, trading_total: 0 };
        dpAgg[row.trader_name].gross           += parseFloat(row.gross)           || 0;
        dpAgg[row.trader_name].gateway_charge  += parseFloat(row.gateway_charge)  || 0;
        dpAgg[row.trader_name].exe_fee         += parseFloat(row.exe_fee)         || 0;
        dpAgg[row.trader_name].trading_total   += parseFloat(row.trading_total)   || 0;
      }
      setDailyDiff(Object.keys(dpAgg).length > 0 ? dpAgg : null);
      setPreview({ ...r, filename: file.name, file });
      showToast("解析成功，请核对差异后确认入库");
    } catch (e: any) { showToast(e.message, false); }
    setLoading(false); if (fileRef.current) fileRef.current.value = "";
  };
  const confirmUpload = async () => {
    if (!preview?.file) return; setLoading(true);
    try {
      const fd = new FormData(); fd.append("file", preview.file); fd.append("period", period); fd.append("confirm", "true");
      await callFunctionForm("parse-csv", fd);
      showToast("数据已入库"); setPreview(null); reload();
    } catch (e: any) { showToast(e.message, false); }
    setLoading(false);
  };

  // ── Commission ───────────────────────────────────────────
  const handleCalc = async (action: string) => {
    setLoading(true);
    try {
      const r = await callFunction("smooth-service", { action, period });
      if (action === "calculate") {
        setCalcResult(r);
        if (r?.results?.length) {
          // Don't overwrite already-confirmed records
          const { data: alreadyConfirmed } = await supabase.from("commission_results")
            .select("trader_id").eq("period", period).eq("status", "confirmed").limit(1);
          if (!alreadyConfirmed?.length) {
            const rows = r.results.map((row: any) => ({ ...row, period, status: "draft" }));
            const { error } = await supabase.from("commission_results").upsert(rows, { onConflict: "trader_id,period" });
            if (error) showToast("草稿保存失败: " + error.message, false);
          }
        }
        // Reload commissions so badge reflects DB status
        supabase.from("commission_results").select("*").eq("period", period)
          .then(({ data }) => {
            if (data?.length) setCommissions((prev:any[]) => [...prev.filter((c:any) => c.period !== period), ...data]);
          });
        showToast("计算完成（草稿）");
      }
      if (action === "verify")    { setVerify(r.verification); showToast(r.verification.overall_pass ? "核对通过 ✓" : "有差异，请检查", r.verification.overall_pass); }
      if (action === "confirm") {
        // 1. 状态置为已核对
        const { error } = await supabase.from("commission_results")
          .update({ status: "confirmed", confirmed_at: new Date().toISOString() })
          .eq("period", period);
        if (error) console.warn("confirm update:", error.message);

        // 2. 把计提提成（monthly_usd）写入保证金 margin_ledger（type=commission）
        //    幂等：同一 trader+period 已有 commission 记录则跳过，避免重复计入。
        const [yy, mm] = period.split("-").map(Number);
        const entryDate = `${period}-${String(new Date(yy, mm, 0).getDate()).padStart(2, "0")}`;
        const { data: confirmedRows } = await supabase.from("commission_results")
          .select("*").eq("period", period).eq("status", "confirmed");
        for (const cr of confirmedRows || []) {
          const { data: existing } = await supabase.from("margin_ledger")
            .select("id").eq("trader_id", cr.trader_id).eq("period", period).eq("type", "commission").limit(1);
          if (existing?.length) continue;
          const { data: led } = await supabase.from("margin_ledger").select("amount_usd").eq("trader_id", cr.trader_id);
          const prev = (led || []).reduce((s: number, x: any) => s + parseFloat(x.amount_usd || 0), 0);
          const amt = parseFloat(cr.monthly_usd) || 0;
          await supabase.from("margin_ledger").insert({
            trader_id: cr.trader_id, period, entry_date: entryDate,
            type: "commission", amount_usd: amt, fx_rate: cr.fx_rate,
            balance_after: Math.round((prev + amt) * 10000) / 10000,
            note: `计提 ${period}`,
          });
        }
        showToast("已确认发布，计提已计入保证金"); reload();
      }
    } catch (e: any) { showToast(e.message, false); }
    setLoading(false);
  };

  // ── Settlement screenshot preview & OCR ────────────────────────
  const handleImgUpload = async (e: React.ChangeEvent<HTMLInputElement> | any) => {
    let file = e.target?.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    setSettlImg(url);
    showToast("✓ 截图已上传，正在识别...");

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64Data = reader.result;
        const response = await fetch("http://localhost:18765/ocr", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: base64Data }),
        });
        if (!response.ok) throw new Error(`OCR 服务错误: ${response.status}`);
        const result = await response.json();
        console.log("OCR 识别结果:", result);
        if (result.success && result.data) {
          const data = result.data;
          setSForm((p: any) => {
            const updated = { ...p };
            for (const [key, value] of Object.entries(data)) {
              if (value !== null) updated[key] = value;
            }
            return updated;
          });
          const fieldCount = Object.values(data).filter(v => v !== null).length;
          showToast(`✓ 识别成功，共识别 ${fieldCount} 个字段`);
        } else {
          showToast("⚠ 未能识别表格数据: " + (result.error || "未知错误"), false);
        }
      } catch (err: any) {
        console.error("识别错误:", err);
        showToast("识别失败: " + err.message, false);
      }
    };
    reader.readAsDataURL(file);
  };

  // ── Settlement PDF ────────────────────────────────────────
  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setPdfParsing(true);
    try {
      const parsed = await parsePdf(file);
      const differences: string[] = [];
      const fieldsToCompare: [string, string][] = [
        ["equity_aud", "AUD Equity"],
        ["cut_aud", "AUD Cut 15%"],
        ["net_aud", "AUD Net 85%"],
        ["exe_aud", "AUD Transaction Fees"],
        ["equity_hkd", "HKD Equity"],
        ["cut_hkd", "HKD Cut 15%"],
        ["net_hkd", "HKD Net 85%"],
        ["exe_hkd", "HKD Transaction Fees"],
        ["adjustment_sub_total_aud", "Adjustments AUD"],
        ["adjustment_sub_total_hkd", "Adjustments HKD"],
        ["adjustment_sub_total_usd", "Adjustments USD"],
        ["post_exchange_usd", "Post Exchange USD"],
      ];
      for (const [field, label] of fieldsToCompare) {
        const currentVal = parseFloat(sForm[field] || "0");
        const pdfVal = parseFloat(parsed[field] || "0");
        if (Math.abs(currentVal - pdfVal) > 0.01) {
          differences.push(`${label}: 截图=${currentVal} vs PDF=${pdfVal}`);
        }
      }
      const isMatch = differences.length === 0;
      setSettlementMatchStatus({ match: isMatch, differences });
      if (!isMatch) {
        showToast(`PDF 核对发现差异（${differences.length} 项）`, false);
      } else {
        showToast("✓ PDF 数据与截图识别数据完全匹配");
      }
      setSettlView("edit");
    } catch (err: any) { showToast("PDF 解析失败: " + err.message, false); }
    setPdfParsing(false);
    if (pdfRef.current) pdfRef.current.value = "";
    if (settlPdfRef.current) settlPdfRef.current.value = "";
  };

  // ── Trigger settlement PDF fetch via local server ─────────
  const triggerSettlFetch = async () => {
    setFetchingSettl(true);
    try {
      const res = await fetch(
        `${FETCH_SERVER}/fetch-settlement?period=${period}`,
        { signal: AbortSignal.timeout(60000) }
      );
      if (!res.ok) throw new Error(await readLocalFetchError(res));
      const r = await res.json();
      if (r.error) throw new Error(r.error);
      // Populate sForm with parsed data from server
      const p = r.parsed ?? {};
      const parsedPe = p.payment_exchange ?? [];
      const { data: dbSettlement, error: dbSettlementError } = await supabase
        .from("settlement_records")
        .select("payment_exchange")
        .eq("period", period)
        .maybeSingle();
      if (dbSettlementError) throw dbSettlementError;
      const dbPe = dbSettlement?.payment_exchange ?? [];
      const formPe = (sForm.period || period) === period ? sForm.payment_exchange ?? [] : [];
      const currentPe = hasPaymentExchange(dbPe) ? dbPe : formPe;
      const protectPaymentExchange = hasPaymentExchange(currentPe);
      const peDiff = paymentExchangeDiffers(currentPe, parsedPe);
      setSForm((prev: any) => {
        const prevPe = (prev.period || period) === period ? prev.payment_exchange : [];
        const finalPe = hasPaymentExchange(dbPe) ? dbPe : (hasPaymentExchange(prevPe) ? prevPe : parsedPe);
        return { period, equity_aud: p.equity_aud?.toString() ?? "", cut_aud: p.cut_aud?.toString() ?? "", net_aud: p.net_aud?.toString() ?? "", exe_aud: p.exe_aud?.toString() ?? "", equity_hkd: p.equity_hkd?.toString() ?? "", cut_hkd: p.cut_hkd?.toString() ?? "", net_hkd: p.net_hkd?.toString() ?? "", exe_hkd: p.exe_hkd?.toString() ?? "", post_exchange_aud: p.post_exchange_aud?.toString() ?? "", post_exchange_hkd: p.post_exchange_hkd?.toString() ?? "", post_exchange_usd: p.post_exchange_usd?.toString() ?? "", wire_fees_usd: p.wire_fees_usd?.toString() ?? "", fx_notes: "", loss_coverage: p.loss_coverage ?? [], payment_exchange: finalPe, erp_deposits: p.erp_deposits ?? [], erp_withdrawals: p.erp_withdrawals ?? [] };
      });
      if (!protectPaymentExchange && hasPaymentExchange(parsedPe)) {
        const { fxAudUsd, fxHkdUsd } = derivePaymentExchangeFx(parsedPe);
        if (fxAudUsd) setFForm((f: any) => ({ ...f, fx_aud_usd: fxAudUsd.toFixed(8) }));
        if (fxHkdUsd) setFForm((f: any) => ({ ...f, fx_hkd_usd: fxHkdUsd.toFixed(8) }));
      }
      showToast(peDiff ? "抓取到的 Payment Exchange 与当前已确认值不同，已保留当前值" : "PDF 抓取解析成功，请核对后保存");
      setSettlView("edit");
    } catch (e: any) {
      if (e.message?.includes("fetch") || e.name === "TypeError") {
        showToast("无法连接本地服务，请确认 fetch_server.py 已启动", false);
      } else {
        showToast("抓取失败: " + e.message, false);
      }
    }
    setFetchingSettl(false);
  };

  const saveSettlement = async () => {
    setLoading(true);
    try {
      const numFields = ["equity_aud","cut_aud","net_aud","exe_aud","equity_hkd","cut_hkd","net_hkd","exe_hkd","adjustment_sub_total_aud","adjustment_sub_total_hkd","adjustment_sub_total_usd","post_exchange_aud","post_exchange_hkd","post_exchange_usd","wire_fees_usd"];
      const payload: any = { period: sForm.period || period };
      for (const k of numFields) payload[k] = sForm[k] !== "" ? parseFloat(sForm[k]) : null;
      payload.fx_notes = sForm.fx_notes || null;
      const finalPaymentExchange = normalizePaymentExchangeRates(sForm.payment_exchange);
      payload.loss_coverage = sForm.loss_coverage; payload.payment_exchange = finalPaymentExchange;
      payload.erp_deposits = sForm.erp_deposits; payload.erp_withdrawals = sForm.erp_withdrawals;
      const { error } = await db.upsertSettlement(payload);
      if (error) throw error;

      // Auto-sync fx rates only from the final confirmed payment_exchange.
      const { fxAudUsd: saveAud, fxHkdUsd: saveHkd } = derivePaymentExchangeFx(finalPaymentExchange);
      if (saveAud || saveHkd) {
        const fxPayload: any = { period: sForm.period || period };
        if (saveAud) fxPayload.fx_aud_usd = saveAud;
        if (saveHkd) fxPayload.fx_hkd_usd = saveHkd;
        await supabase.from("period_fees").upsert(fxPayload, { onConflict: "period" });
        if (saveAud) setFForm((f: any) => ({ ...f, fx_aud_usd: saveAud.toFixed(8) }));
        if (saveHkd) setFForm((f: any) => ({ ...f, fx_hkd_usd: saveHkd.toFixed(8) }));
      }

      // 联动：把编辑页的 USD 存入同步到主页 ERP 账户（erp_ledger）。
      // 幂等：先删除本月由此处自动生成的记录，再按当前存入重建，不影响手动添加的记录。
      const linkPeriod = sForm.period || period;
      const AUTO_NOTE = "⟳ 来自 Settlement 编辑";
      await supabase.from("erp_ledger").delete()
        .eq("settlement_period", linkPeriod).eq("type", "settlement_deposit").eq("note", AUTO_NOTE);
      const usdDeposits = (sForm.erp_deposits || []).filter(
        (d: any) => (d.ccy || "USD") === "USD" && Math.abs(parseFloat(d.amount)) > 0
      );
      if (usdDeposits.length > 0) {
        const toISO = (s: string) => {
          const v = (s || "").trim();
          let m = v.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);   // YYYY-MM-DD / YYYY/M/D
          if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
          m = v.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);       // MM/DD/YYYY / M/D/YYYY
          if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
          return `${linkPeriod}-01`;
        };
        await supabase.from("erp_ledger").insert(usdDeposits.map((d: any) => ({
          entry_date: toISO(d.date),
          type: "settlement_deposit",
          amount_usd: Math.abs(parseFloat(d.amount)),
          settlement_period: linkPeriod,
          note: AUTO_NOTE,
        })));
      }

      showToast("Settlement 已保存" + (saveAud || saveHkd ? "，汇率已同步" : ""));
      reload(); setSettlView("list");
    } catch (e: any) { showToast(e.message, false); }
    setLoading(false);
  };

  // ── Delete helpers ───────────────────────────────────────
  const deleteMarginEntry = (id: number) => {
    askConfirm("确认删除这条保证金流水？此操作不可恢复。", async () => {
      await db.deleteMarginEntry(id); reload(); showToast("已删除");
    });
  };

  const deletePayout = (p: any) => {
    askConfirm(`确认删除 ${TRADERS[p.trader_id]?.name} ${p.payout_date} 的发放记录？\n同时会撤销对应的保证金扣减，余额将恢复。`, async () => {
      setLoading(true);
      try {
        await supabase.from("commission_payouts").delete().eq("id", p.id);
        // Rollback matching withdraw in margin_ledger
        await supabase.from("margin_ledger")
          .delete()
          .eq("trader_id", p.trader_id)
          .eq("type", "withdraw")
          .eq("entry_date", p.payout_date)
          .eq("amount_usd", -(parseFloat(p.settle_usd)));
        showToast("发放记录已删除，保证金已恢复"); reload();
      } catch(e: any) { showToast(e.message, false); }
      setLoading(false);
    });
  };

  // ── Payouts ──────────────────────────────────────────────
  const addPayout = async () => {
    if (!pForm.balance_usd || !pForm.fx_cny) return;
    setLoading(true);
    try {
      const balanceUsd = parseFloat(pForm.balance_usd);
      const reserveUsd = parseFloat(pForm.reserve_usd || "0");
      const settleUsd  = balanceUsd - reserveUsd;
      const fxCny      = parseFloat(pForm.fx_cny);
      const cnyAmount  = Math.round(settleUsd * fxCny * 100) / 100;
      const { error } = await supabase.from("commission_payouts").insert({ payout_date: pForm.payout_date, trader_id: pForm.trader_id, balance_usd: balanceUsd, reserve_usd: reserveUsd, settle_usd: settleUsd, fx_cny: fxCny, cny_amount: cnyAmount, period_covered: pForm.period_covered, bank_account: pForm.bank_account, note: pForm.note });
      if (error) throw error;
      const { data: rows } = await supabase.from("margin_ledger").select("amount_usd").eq("trader_id", pForm.trader_id);
      const prevBal = (rows || []).reduce((s: number, e: any) => s + parseFloat(e.amount_usd), 0);
      await supabase.from("margin_ledger").insert({ trader_id: pForm.trader_id, period: pForm.period_covered || "", entry_date: pForm.payout_date, type: "withdraw", amount_usd: -settleUsd, fx_rate: fxCny, balance_after: Math.round((prevBal - settleUsd) * 10000) / 10000, note: `提成发放 ${pForm.period_covered || ""} ¥${Math.round(cnyAmount).toLocaleString()}` });
      showToast(`已发放 ¥${Math.round(cnyAmount).toLocaleString()}`);
      setSessionCnyTotal((prev: number) => prev + cnyAmount);
      setPForm(emptyPForm); reload();
    } catch (e: any) { showToast(e.message, false); }
    setLoading(false);
  };

  // ── Batch Payout Rows ────────────────────────────────────
  const updatePayoutRow = (idx: number, field: string, value: string) => {
    setPayoutRows((rows: any[]) => rows.map((r, i) => {
      if (i !== idx) return r;
      const updated = { ...r, [field]: value };
      if (field === "trader_id") {
        const cfg = TRADERS[value];
        updated._reserve = cfg?.reserve ?? 0;
        const lastPayout = payouts.filter((p: any) => p.trader_id === value).sort((a: any, b: any) => b.payout_date.localeCompare(a.payout_date))[0];
        updated.bank_account = lastPayout?.bank_account ?? "";
      }
      return updated;
    }));
  };
  const addPayoutRow = () => setPayoutRows((rows: any[]) => [...rows, emptyPayoutRow()]);
  const removePayoutRow = (idx: number) => setPayoutRows((rows: any[]) => rows.filter((_: any, i: number) => i !== idx));

  const submitAllPayoutRows = async () => {
    const valid = payoutRows.filter(r => r.fx_cny && parseFloat(r.fx_cny) > 0);
    if (!valid.length) return;
    setLoading(true);
    let totalCny = 0; let totalUsd = 0;
    for (const row of valid) {
      try {
        const cfg = TRADERS[row.trader_id];
        const bal = balances.find((b: any) => b.trader_id === row.trader_id);
        const balanceUsd = bal ? parseFloat(bal.balance_usd) : 0;
        const reserveUsd = cfg?.reserve ?? 0;
        const settleUsd = Math.round((balanceUsd - reserveUsd) * 10000) / 10000;
        const fxCny = parseFloat(row.fx_cny);
        const cnyAmount = Math.round(settleUsd * fxCny * 100) / 100;
        const { error } = await supabase.from("commission_payouts").insert({ payout_date: payoutDate, trader_id: row.trader_id, balance_usd: balanceUsd, reserve_usd: reserveUsd, settle_usd: settleUsd, fx_cny: fxCny, cny_amount: cnyAmount, period_covered: row.period_covered, bank_account: row.bank_account, note: "" });
        if (error) throw error;
        const { data: ledgerRows } = await supabase.from("margin_ledger").select("amount_usd").eq("trader_id", row.trader_id);
        const prevBal = (ledgerRows || []).reduce((s: number, e: any) => s + parseFloat(e.amount_usd), 0);
        await supabase.from("margin_ledger").insert({ trader_id: row.trader_id, period: row.period_covered || "", entry_date: payoutDate, type: "withdraw", amount_usd: -settleUsd, fx_rate: fxCny, balance_after: Math.round((prevBal - settleUsd) * 10000) / 10000, note: `提成发放 ${row.period_covered || ""} ¥${Math.round(cnyAmount).toLocaleString()}` });
        totalCny += cnyAmount; totalUsd += settleUsd;
      } catch (e: any) { showToast(`${TRADERS[row.trader_id]?.name} 失败: ${(e as any).message}`, false); }
    }
    if (totalCny > 0) {
      showToast(`已发放 ¥${Math.round(totalCny).toLocaleString()} / $${f2(totalUsd)}`);
      setSessionCnyTotal((prev: number) => prev + totalCny);
      setSessionUsdTotal((prev: number) => prev + totalUsd);
      setPayoutRows([emptyPayoutRow()]);
      reload();
    }
    setLoading(false);
  };

  // ── USD Bank Receipts ────────────────────────────────────
  const saveUsdReceipt = async () => {
    if (!usdRForm.amount_usd) return;
    setLoading(true);
    try {
      const { error } = await supabase.from("usd_bank_receipts").insert({
        receipt_date: usdRForm.receipt_date,
        amount_usd: parseFloat(usdRForm.amount_usd),
        note: usdRForm.note,
        is_settled: false,
      });
      if (error) throw error;
      showToast("收款记录已保存");
      setUsdRForm({ receipt_date: new Date().toISOString().slice(0, 10), amount_usd: "", note: "" });
      reload();
    } catch (e: any) { showToast(e.message, false); }
    setLoading(false);
  };

  const deleteUsdReceipt = async (id: number) => {
    setLoading(true);
    try {
      const { error } = await supabase.from("usd_bank_receipts").delete().eq("id", id);
      if (error) throw error;
      showToast("已删除"); reload();
    } catch (e: any) { showToast(e.message, false); }
    setLoading(false);
  };

  const markReceiptSettled = async (id: number) => {
    setLoading(true);
    try {
      const { error } = await supabase.from("usd_bank_receipts").update({ is_settled: true }).eq("id", id);
      if (error) throw error;
      showToast("已标记为已结算"); reload();
    } catch (e: any) { showToast(e.message, false); }
    setLoading(false);
  };

  const applyAutoRate = () => {
    const totalCny = parseFloat(cnyBatchInput) || 0;
    const pendingUsd = usdReceipts.filter((r: any) => !r.is_settled).reduce((s: number, r: any) => s + parseFloat(r.amount_usd || 0), 0);
    if (totalCny > 0 && pendingUsd > 0) {
      const rate = (totalCny / pendingUsd).toFixed(4);
      setPayoutRows((rows: any[]) => rows.map((r: any) => ({ ...r, fx_cny: rate })));
      showToast(`汇率已同步：${rate}`);
    }
  };

  // ── ERP Ledger ───────────────────────────────────────────
  const saveErpEntry = async () => {
    if (!erpForm.amount_usd) return;
    setLoading(true);
    try {
      const isWd = erpForm.type === "withdrawal";
      const amount = (isWd ? -1 : 1) * Math.abs(parseFloat(erpForm.amount_usd));
      const { error } = await supabase.from("erp_ledger").insert({
        entry_date: erpForm.entry_date, type: erpForm.type, amount_usd: amount,
        settlement_period: erpForm.settlement_period || null, note: erpForm.note,
      });
      if (error) throw error;
      showToast("ERP 记录已保存");
      setErpForm({ entry_date: new Date().toISOString().slice(0,10), type: "settlement_deposit", amount_usd: "", settlement_period: "", note: "" });
      reload();
    } catch (e: any) { showToast(e.message, false); }
    setLoading(false);
  };

  const deleteErpEntry = async (id: number) => {
    setLoading(true);
    try {
      const { error } = await supabase.from("erp_ledger").delete().eq("id", id);
      if (error) throw error;
      showToast("已删除"); reload();
    } catch (e: any) { showToast(e.message, false); }
    setLoading(false);
  };

  // ── Daily Performance Upload ─────────────────────────────
  const handleDailyUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setLoading(true);
    try {
      const text = await file.text();
      const lines = text.trim().split("\n");
      const header = lines[0].split(",").map(h => h.trim().replace(/"/g, "").toLowerCase());
      const get = (row: string[], key: string) => {
        const i = header.indexOf(key); return i >= 0 ? row[i]?.replace(/"/g, "").trim() : "";
      };
      const rows = lines.slice(1).map(line => {
        const cols = line.split(",");
        return {
          trade_date:     get(cols, "trade_date") || get(cols, "date"),
          trader_name:    get(cols, "trader_name") || get(cols, "trader"),
          currency:       get(cols, "currency") || get(cols, "ccy"),
          gross:          parseFloat(get(cols, "gross")) || 0,
          gateway_charge: parseFloat(get(cols, "gateway_charge") || get(cols, "gateway")) || 0,
          sec_fee:        parseFloat(get(cols, "sec_fee")) || 0,
          act_fee:        parseFloat(get(cols, "act_fee")) || 0,
          exe_fee:        parseFloat(get(cols, "exe_fee")) || 0,
          trading_total:  parseFloat(get(cols, "trading_total")) || 0,
          shares:         parseFloat(get(cols, "shares")) || 0,
          trades_made:    parseInt(get(cols, "trades_made")) || 0,
        };
      }).filter(r => r.trade_date && r.trader_name);
      if (!rows.length) throw new Error("CSV 格式不匹配，未能解析出数据行");
      const { error } = await supabase.from("daily_performance").upsert(rows, { onConflict: "trade_date,trader_name" });
      if (error) throw error;
      showToast(`已导入 ${rows.length} 条每日数据`);
      loadDailyData(dailyFilter.dateFrom, dailyFilter.dateTo);
    } catch (e: any) { showToast(e.message, false); }
    setLoading(false);
    if (dailyUploadRef.current) dailyUploadRef.current.value = "";
  };

  // ── Trigger Remote Fetch ──────────────────────────────────
  const FETCH_SERVER = "http://localhost:18765";
  const readLocalFetchError = async (res: Response) => {
    const fallback = `服务器返回 ${res.status}`;
    try {
      const text = await res.text();
      if (!text) return fallback;
      try {
        const body = JSON.parse(text);
        return body.error || body.message || text;
      } catch {
        return text;
      }
    } catch {
      return fallback;
    }
  };

  const triggerDailyFetch = async () => {
    setFetchingDaily(true);
    try {
      const res = await fetch(
        `${FETCH_SERVER}/fetch?from=${dailyFilter.dateFrom}&to=${dailyFilter.dateTo}`,
        { signal: AbortSignal.timeout(120000) }
      );
      if (!res.ok) throw new Error(await readLocalFetchError(res));
      const r = await res.json();
      if (r.error) throw new Error(r.error);
      showToast(r.message || `抓取完成，共 ${r.rows ?? 0} 条`);
      loadDailyData(dailyFilter.dateFrom, dailyFilter.dateTo);
    } catch (e: any) {
      if (e.message?.includes("fetch") || e.name === "TypeError") {
        showToast("无法连接本地服务，请确认 fetch_server.py 已启动", false);
      } else {
        showToast("抓取失败: " + e.message, false);
      }
    }
    setFetchingDaily(false);
  };

  const handleMonthlyFetch = async () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const dateFrom = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const dateTo = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    setFetchingDaily(true);
    try {
      const res = await fetch(
        `${FETCH_SERVER}/fetch?from=${dateFrom}&to=${dateTo}`,
        { signal: AbortSignal.timeout(120000) }
      );
      if (!res.ok) throw new Error(await readLocalFetchError(res));
      const r = await res.json();
      if (r.error) throw new Error(r.error);
      showToast(r.message || `全月抓取完成，共 ${r.rows ?? 0} 条`);
      loadDailyData(dateFrom, dateTo);
    } catch (e: any) {
      if (e.message?.includes("fetch") || e.name === "TypeError") {
        showToast("无法连接本地服务，请确认 fetch_server.py 已启动", false);
      } else {
        showToast("全月抓取失败: " + e.message, false);
      }
    }
    setFetchingDaily(false);
  };

  const handleLockCurrentMonth = async () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const period = `${year}-${String(month).padStart(2, "0")}`;
    setLoading(true);
    try {
      // 1. 标记该月 daily_performance 为已锁定
      const { error } = await supabase.from("daily_performance")
        .update({ is_confirmed: true })
        .like("trade_date", `${period}%`);
      if (error) throw error;

      // 2. 汇总该月 daily_performance → trade_records（供提成计算），按交易员累加
      const { data: dp } = await supabase.from("daily_performance").select("*").like("trade_date", `${period}%`);
      const nameToId: Record<string, string> = {};
      for (const [id, cfg] of Object.entries(TRADERS)) nameToId[(cfg as any).name] = id;
      const resolveId = (tn: string) => (TRADERS as any)[tn] ? tn : (nameToId[tn] || tn);
      const agg: Record<string, any> = {};
      for (const row of dp || []) {
        const tid = resolveId(row.trader_name);
        if (!(TRADERS as any)[tid]) continue;
        if (!agg[tid]) agg[tid] = { trader_id: tid, period, gross: 0, gateway_charge: 0, exe_fee: 0, sec_fee: 0, ccy: (TRADERS as any)[tid].ccy, source_file: `daily_lock_${period}` };
        agg[tid].gross += parseFloat(row.gross) || 0;
        agg[tid].gateway_charge += parseFloat(row.gateway_charge) || 0;
        agg[tid].exe_fee += parseFloat(row.exe_fee) || 0;
        agg[tid].sec_fee += parseFloat(row.sec_fee) || 0;
      }
      const aggRows = Object.values(agg);
      aggRows.forEach((r: any) => {
        r.gross = Math.round(r.gross * 10000) / 10000;
        r.gateway_charge = Math.round(r.gateway_charge * 10000) / 10000;
        r.exe_fee = Math.round(r.exe_fee * 10000) / 10000;
        r.sec_fee = Math.round(r.sec_fee * 10000) / 10000;
      });
      // 已确认月份不覆盖，保护已锁定的提成基础
      const { data: locked } = await supabase.from("commission_results")
        .select("trader_id").eq("period", period).eq("status", "confirmed").limit(1);
      if (aggRows.length > 0 && !locked?.length) {
        await supabase.from("trade_records").upsert(aggRows, { onConflict: "trader_id,period" });
      }

      showToast(`✓ ${period} 数据已锁定${aggRows.length && !locked?.length ? `并汇总（${aggRows.length} 位交易员）` : ""}`);
      loadDailyData(dailyFilter.dateFrom, dailyFilter.dateTo);
      reload();
    } catch (e: any) {
      showToast("数据锁定失败: " + e.message, false);
    }
    setLoading(false);
  };

  // ── Fees ─────────────────────────────────────────────────
  const saveFees = async () => {
    setLoading(true);
    try {
      const editableFeeKeys = ["period", "asx_aud", "chixa_usd", "hke_hkd", "office_usd", "wire_usd"];
      const payload = Object.fromEntries(
        editableFeeKeys.map((k) => {
          const v = fForm[k];
          return [k, k !== "period" && v !== "" ? parseFloat(v as string) : (v === "" ? null : v)];
        })
      );
      const { data: existingFee } = await supabase
        .from("period_fees")
        .select("period")
        .eq("period", payload.period)
        .maybeSingle();
      if (!existingFee) {
        payload.fx_aud_usd = 0;
        payload.fx_hkd_usd = 0;
      }
      const { error } = await db.upsertFees(payload);
      if (error) throw error; showToast("配置已保存");
    } catch (e: any) { showToast(e.message, false); }
    setLoading(false);
  };

  // ── Styles ───────────────────────────────────────────────
  const C = {
    bg: "#08111E", surface: "#0E1A2B", elevated: "#152234", border: "#1C2E44",
    text: "#DCE8F5", muted: "#7A95B0", faint: "#3A5068",
    blue: "#4080FF", green: "#34C47C", red: "#F05050", warn: "#E8A530",
  };
  const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', sans-serif";
  const inp: React.CSSProperties = { background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px", color: C.text, fontSize: 16, fontFamily: font, outline: "none", width: "100%", boxSizing: "border-box" };
  const card: React.CSSProperties = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: "24px 26px", marginBottom: 18 };
  const lbl: React.CSSProperties = { fontSize: 14, color: C.muted, marginBottom: 7, display: "block", fontWeight: 500 };
  const secHead: React.CSSProperties = { fontSize: 13, color: C.faint, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase" as const, marginBottom: 12 };
  const grid = (cols: string): React.CSSProperties => ({ display: "grid", gridTemplateColumns: cols, gap: 14 });
  const filledBtn = (bg = C.blue): React.CSSProperties => ({ padding: "10px 22px", borderRadius: 8, border: "none", background: bg, color: "#fff", cursor: loading ? "not-allowed" : "pointer", fontSize: 16, fontFamily: font, fontWeight: 600, opacity: loading ? 0.55 : 1 });
  const ghostBtn = (active = false): React.CSSProperties => ({ padding: "8px 16px", borderRadius: 8, border: `1px solid ${active ? C.blue : C.border}`, background: active ? `${C.blue}18` : "transparent", color: active ? C.blue : C.muted, cursor: "pointer", fontSize: 16, fontFamily: font, fontWeight: 500 });

  const renderReadme = (md: string) => {
    const lines = md.split("\n");
    const out: React.ReactNode[] = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (line.startsWith("```")) {
        const codeLines: string[] = []; i++;
        while (i < lines.length && !lines[i].startsWith("```")) { codeLines.push(lines[i]); i++; }
        out.push(<pre key={i} style={{ background: C.elevated, border:`1px solid ${C.border}`, borderRadius: 8, padding: "12px 16px", fontSize: 14, overflowX: "auto", margin: "8px 0", color: C.text, fontFamily: "monospace" }}><code>{codeLines.join("\n")}</code></pre>);
        i++; continue;
      }
      if (line.startsWith("|")) {
        const rows: string[][] = [];
        while (i < lines.length && lines[i].startsWith("|")) {
          const cells = lines[i].split("|").slice(1, -1).map(c => c.trim());
          if (!cells.every(c => /^[-: ]+$/.test(c))) rows.push(cells);
          i++;
        }
        if (rows.length > 0) out.push(<div key={i} style={{ overflowX: "auto", margin: "8px 0" }}><table style={{ borderCollapse: "collapse", fontSize: 15, width: "100%" }}><thead><tr>{rows[0].map((c,j) => <th key={j} style={{ border:`1px solid ${C.border}`, padding: "6px 12px", textAlign: "left", background: C.elevated, fontWeight: 700, color: C.text }}>{c}</th>)}</tr></thead><tbody>{rows.slice(1).map((row, ri) => (<tr key={ri}>{row.map((c, j) => <td key={j} style={{ border:`1px solid ${C.border}`, padding: "5px 12px", color: C.muted }}>{c.replace(/^`|`$/g, "")}</td>)}</tr>))}</tbody></table></div>);
        continue;
      }
      if (/^---+$/.test(line.trim())) { out.push(<hr key={i} style={{ border: "none", borderTop: `1px solid ${C.border}`, margin: "16px 0" }} />); i++; continue; }
      if (line.startsWith("# "))  { out.push(<h1 key={i} style={{ fontSize: 22, fontWeight: 700, color: C.text,  margin: "20px 0 8px" }}>{line.slice(2)}</h1>);  i++; continue; }
      if (line.startsWith("## ")) { out.push(<h2 key={i} style={{ fontSize: 18, fontWeight: 700, color: C.text,  margin: "16px 0 6px" }}>{line.slice(3)}</h2>); i++; continue; }
      if (line.startsWith("### ")){ out.push(<h3 key={i} style={{ fontSize: 16, fontWeight: 700, color: C.blue,  margin: "12px 0 4px" }}>{line.slice(4)}</h3>); i++; continue; }
      const inline = (text: string) => text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((p, pi) => {
        if (p.startsWith("**") && p.endsWith("**")) return <strong key={pi} style={{ color: C.text }}>{p.slice(2,-2)}</strong>;
        if (p.startsWith("`")  && p.endsWith("`"))  return <code key={pi} style={{ background: C.elevated, borderRadius: 3, padding: "1px 5px", fontSize: 14, fontFamily: "monospace", color: C.green }}>{p.slice(1,-1)}</code>;
        return p;
      });
      if (line.startsWith("> ")) { out.push(<blockquote key={i} style={{ borderLeft: `3px solid ${C.blue}`, paddingLeft: 12, margin: "6px 0", color: C.muted, fontSize: 15 }}>{inline(line.slice(2))}</blockquote>); i++; continue; }
      if (line.startsWith("- ") || line.startsWith("  - ")) { out.push(<div key={i} style={{ display: "flex", gap: 6, margin: "3px 0", paddingLeft: line.startsWith("  ") ? 20 : 0, fontSize: 15 }}><span style={{ color: C.blue, flexShrink: 0 }}>·</span><span style={{ color: C.muted }}>{inline(line.replace(/^\s*-\s/, ""))}</span></div>); i++; continue; }
      if (line.trim() === "") { out.push(<div key={i} style={{ height: 6 }} />); i++; continue; }
      out.push(<p key={i} style={{ fontSize: 15, color: C.muted, margin: "4px 0", lineHeight: 1.7 }}>{inline(line)}</p>);
      i++;
    }
    return out;
  };

  const tag = (color: string): React.CSSProperties => ({ fontSize: 13, padding: "2px 8px", borderRadius: 4, background: `${color}18`, color, fontWeight: 600, display: "inline-block" });

  const TABS: { k: Tab; l: string }[] = [
    { k: "overview",    l: "交易员概要" },
    { k: "daily",       l: "业绩查询" },
    { k: "settlement",  l: "Settlement" },
    { k: "payouts",     l: "提成发放" },
    { k: "config",      l: "结算参数" },
    { k: "readme",      l: "系统文档" },
  ];

  const alertCount = balances.filter(b => b.status !== "ok").length;

  const sideNavBtn = (active = false): React.CSSProperties => ({
    display: "block", width: "100%", padding: "10px 16px", borderRadius: 8,
    border: "none", textAlign: "left", cursor: "pointer", fontSize: 16,
    fontFamily: font, fontWeight: active ? 600 : 400,
    background: active ? `${C.blue}20` : "transparent",
    color: active ? C.blue : C.muted,
    transition: "background 0.15s, color 0.15s",
  });

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: C.bg, color: C.text, fontFamily: font }}>

      {/* ── Left Sidebar ── */}
      <aside style={{ width: 210, flexShrink: 0, background: C.surface, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", position: "sticky", top: 0, height: "100vh", overflow: "hidden" }}>
        {/* Logo */}
        <div style={{ padding: "24px 20px 18px", borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 19, fontWeight: 800, color: C.text, letterSpacing: 0.5 }}>31O-1232</div>
          <div style={{ fontSize: 13, color: C.faint, marginTop: 4 }}>DTPPro8</div>
        </div>

        {/* Nav items */}
        <nav style={{ flex: 1, padding: "14px 10px", display: "flex", flexDirection: "column", gap: 2, overflowY: "auto" }}>
          {TABS.map(t => (
            <button key={t.k} onClick={() => setTab(t.k)} style={{ ...sideNavBtn(tab === t.k), position: "relative" }}>
              {t.l}
            </button>
          ))}
        </nav>

        {/* Bottom: alert + logout */}
        <div style={{ padding: "12px 10px", borderTop: `1px solid ${C.border}`, display: "flex", flexDirection: "column", gap: 8 }}>
          {alertCount > 0 && (
            <div style={{ fontSize: 13, fontWeight: 600, color: C.warn, background: `${C.warn}18`, border: `1px solid ${C.warn}40`, padding: "5px 10px", borderRadius: 8, textAlign: "center" }}>⚠ {alertCount} 人预警</div>
          )}
          <button onClick={onLogout} style={{ ...sideNavBtn(), textAlign: "center", border: `1px solid ${C.border}` }}>退出</button>
        </div>
      </aside>

      {/* ── Main Content ── */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>

        {toast && <div style={{ padding: "11px 28px", fontSize: 16, fontWeight: 500, color: toast.ok ? C.green : C.red, background: `${toast.ok ? C.green : C.red}12`, borderBottom: `1px solid ${toast.ok ? C.green : C.red}28` }}>{toast.ok ? "✓" : "✗"}&ensp;{toast.msg}</div>}

        {/* Confirm Dialog */}
        {confirmDlg && (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center" }}>
            <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:16, padding:"28px 32px", maxWidth:420, width:"90%" }}>
              <div style={{ fontSize:15, fontWeight:600, marginBottom:20, lineHeight:1.6, whiteSpace:"pre-line" }}>{confirmDlg.msg}</div>
              <div style={{ display:"flex", gap:12, justifyContent:"flex-end" }}>
                <button onClick={()=>setConfirmDlg(null)} style={ghostBtn()}>取消</button>
                <button onClick={()=>{ confirmDlg.onOk(); setConfirmDlg(null); }} style={filledBtn(C.red)}>确认</button>
              </div>
            </div>
          </div>
        )}

        {/* Top bar with period selector (only for tabs that need it) */}
        {(["performance","payouts"] as Tab[]).includes(tab) && (
          <div style={{ padding: "14px 32px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "flex-end", background: C.surface, gap: 10 }}>
            <span style={{ fontSize: 15, color: C.muted }}>月份</span>
            <select value={period} onChange={e => setPeriod(e.target.value)} style={{ ...inp, width: 120, padding: "7px 12px", fontSize: 15 }}>
              {MONTHS.map(p => <option key={p}>{p}</option>)}
            </select>
          </div>
        )}

      <div style={{ padding: "28px 32px", flex: 1 }}>

        {/* ══ OVERVIEW ══ */}
        {tab === "overview" && (
          <div>
            {/* Trader cards */}
            <div style={{ ...grid("1fr 1fr 1fr"), marginBottom: 24 }}>
              {Object.entries(TRADERS).map(([id, cfg]) => {
                const b = balances.find(x => x.trader_id === id);
                const bal      = b ? parseFloat(b.balance_usd) : 0;
                const reserve  = cfg.reserve;
                const avail    = bal - reserve;
                const pct      = Math.min(100, Math.max(0, (bal / (reserve * 2)) * 100));
                const statusColor = !b || bal <= 0 ? C.red : bal < reserve / 2 ? C.red : bal < reserve ? C.warn : C.green;
                const statusLabel = !b || bal <= 0 ? "🚨 必须充值" : bal < reserve / 2 ? "⚠ 严重不足" : bal < reserve ? "⚠ 低于留存" : "✓ 正常";
                return (
                  <div key={id} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, overflow: "hidden" }}>
                    {/* Header */}
                    <div style={{ padding: "20px 24px 16px", borderBottom: `1px solid ${C.border}` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div>
                          <div style={{ fontSize: 22, fontWeight: 800 }}>{cfg.name}</div>
                          <div style={{ fontSize: 15, color: C.muted, marginTop: 2 }}>{id}</div>
                        </div>
                        <span style={tag(statusColor)}>{statusLabel}</span>
                      </div>
                      <div style={{ marginTop: 12, fontSize: 14, color: C.faint }}>
                        <span style={{ marginRight: 16 }}>📈 {cfg.markets}</span>
                        <span>开通 {cfg.since}</span>
                      </div>
                    </div>
                    {/* Balance */}
                    <div style={{ padding: "20px 24px" }}>
                      <div style={{ fontSize: 14, color: C.muted, marginBottom: 4 }}>账户总余额</div>
                      <div style={{ fontSize: 34, fontWeight: 800, color: statusColor, lineHeight: 1.1 }}>${f2(bal)}</div>
                      <div style={{ fontSize: 14, color: C.faint, marginBottom: 16 }}>USD</div>
                      {/* Progress bar */}
                      <div style={{ height: 6, background: C.elevated, borderRadius: 3, marginBottom: 10, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${pct}%`, background: statusColor, borderRadius: 3, transition: "width 0.4s" }} />
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        <div style={{ background: C.elevated, borderRadius: 8, padding: "10px 14px" }}>
                          <div style={{ fontSize: 13, color: C.faint, marginBottom: 4 }}>保证金留存</div>
                          <div style={{ fontSize: 18, fontWeight: 700, color: C.muted }}>${f2(reserve)}</div>
                        </div>
                        <div style={{ background: C.elevated, borderRadius: 8, padding: "10px 14px" }}>
                          <div style={{ fontSize: 13, color: C.faint, marginBottom: 4 }}>可提取</div>
                          <div style={{ fontSize: 18, fontWeight: 700, color: avail >= 0 ? C.green : C.red }}>
                            {avail >= 0 ? `$${f2(avail)}` : `-$${f2(Math.abs(avail))}`}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Margin ledger */}
            <div style={card}>
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 18 }}>手工录入保证金</div>
              <div style={{ ...grid("1fr 1fr 120px 160px 1fr auto"), alignItems: "end", marginBottom: 0 }}>
                {[
                  { l:"交易员", el:<select style={inp} value={mForm.trader_id} onChange={e=>setMForm(p=>({...p,trader_id:e.target.value}))}>{Object.entries(TRADERS).map(([id,t])=><option key={id} value={id}>{t.name}</option>)}</select> },
                  { l:"类型", el:<select style={inp} value={mForm.type} onChange={e=>setMForm(p=>({...p,type:e.target.value}))}><option value="deposit">存入</option><option value="withdraw">提取/离职</option></select> },
                  { l:"金额 USD", el:<input type="number" style={inp} placeholder="0.00" value={mForm.amount_usd} onChange={e=>setMForm(p=>({...p,amount_usd:e.target.value}))} /> },
                  { l:"日期", el:<input type="date" style={inp} value={mForm.entry_date} onChange={e=>setMForm(p=>({...p,entry_date:e.target.value}))} /> },
                  { l:"备注", el:<input type="text" style={inp} value={mForm.note} onChange={e=>setMForm(p=>({...p,note:e.target.value}))} /> },
                  { l:"", el:<button onClick={addMargin} style={filledBtn()} disabled={loading}>录入</button> },
                ].map(({l,el},i)=><div key={i}>{l&&<label style={lbl}>{l}</label>}{el}</div>)}
              </div>
            </div>

            {/* Ledger list */}
            <div style={{ ...card, padding:0, overflow:"hidden" }}>
              <div style={{ padding:"16px 24px", fontSize:15, fontWeight:600, borderBottom:`1px solid ${C.border}` }}>保证金流水</div>
              <div style={{ display:"grid", gridTemplateColumns:"110px 100px 80px 90px 120px 120px 1fr 34px", padding:"9px 24px", gap:12, fontSize:11, fontWeight:700, color:C.faint, letterSpacing:0.8, background:C.elevated, borderBottom:`1px solid ${C.border}` }}>
                {["操作日期","交易员","类型","状态","金额","余额","备注",""].map(h=><div key={h}>{h}</div>)}
              </div>
              {ledger.length===0&&<div style={{padding:"28px",fontSize:14,color:C.faint,textAlign:"center"}}>暂无记录</div>}
              {ledger.slice(ledgerPage*LEDGER_PAGE_SIZE,(ledgerPage+1)*LEDGER_PAGE_SIZE).map((e:any,i:number)=>{
                const pos=e.amount_usd>0; const col=pos?C.green:C.red;
                // 判断某个 period (e.g. "2026-03") 是否被发放记录覆盖
                // period_covered 支持两种格式: "2026.01-2026.03"(范围) 或 "2026-01,2026-03"(逗号列表)
                const isPeriodCovered = (period: string, covered: string): boolean => {
                  for (const part of covered.split(",").map(s => s.trim())) {
                    const rangeMatch = part.match(/^(\d{4})[.\-](\d{2})[- ](\d{4})[.\-](\d{2})$/);
                    if (rangeMatch) {
                      const start = `${rangeMatch[1]}-${rangeMatch[2]}`;
                      const end   = `${rangeMatch[3]}-${rangeMatch[4]}`;
                      if (period >= start && period <= end) return true;
                    }
                    // 也兼容直接匹配（逗号列表中每项可能是 "2026-03" 或 "2026.03"）
                    if (part.replace(".", "-") === period) return true;
                  }
                  return false;
                };
                const commStatus = e.type==="commission" ? (
                  payouts.some((p:any) => p.trader_id===e.trader_id &&
                    isPeriodCovered(e.period, p.period_covered||""))
                    ? { lbl:"已发放", clr:C.green } : { lbl:"计提", clr:C.warn }
                ) : null;
                return (
                  <div key={e.id} style={{display:"grid",gridTemplateColumns:"110px 100px 80px 90px 120px 120px 1fr 34px",padding:"12px 24px",gap:12,borderBottom:`1px solid ${C.border}`,background:i%2?`${C.elevated}60`:"transparent",alignItems:"center"}}>
                    <div style={{fontSize:12,color:C.muted,lineHeight:1.4}}>
                      {e.type==="commission"||e.type==="deduct"
                        ? e.created_at
                          ? <><div>{new Date(e.created_at).toLocaleDateString("zh-CN",{year:"numeric",month:"2-digit",day:"2-digit"}).replace(/\//g,"-")}</div><div style={{fontSize:11,color:C.faint}}>{new Date(e.created_at).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false})}</div></>
                          : e.entry_date
                        : e.entry_date}
                    </div>
                    <div style={{fontSize:14,fontWeight:600}}>{TRADERS[e.trader_id]?.name}</div>
                    <span style={tag(col)}>{e.type}</span>
                    <div>{commStatus ? <span style={{fontSize:11,padding:"2px 8px",borderRadius:10,fontWeight:700,background:`${commStatus.clr}22`,color:commStatus.clr}}>{commStatus.lbl}</span> : <span style={{color:C.faint}}>—</span>}</div>
                    <div style={{fontSize:14,fontWeight:700,color:col}}>{pos?"+":"-"}${f2(Math.abs(e.amount_usd))}</div>
                    <div style={{fontSize:13,color:C.muted}}>${f2(parseFloat(e.balance_after||0))}</div>
                    <div style={{fontSize:13,color:C.muted}}>{e.note||"—"}</div>
                    <button onClick={()=>deleteMarginEntry(e.id)} style={{background:"transparent",border:`1px solid ${C.border}`,color:C.faint,cursor:"pointer",borderRadius:6,fontSize:13,width:28,height:28,display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
                  </div>
                );
              })}
              {ledger.length > LEDGER_PAGE_SIZE && (
                <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:10,padding:"11px 0",borderTop:`1px solid ${C.border}`}}>
                  <button onClick={()=>setLedgerPage(p=>Math.max(0,p-1))} disabled={ledgerPage===0} style={ghostBtn()}>← 上页</button>
                  <span style={{fontSize:13,color:C.muted}}>第 {ledgerPage+1} / {Math.ceil(ledger.length/LEDGER_PAGE_SIZE)} 页</span>
                  <button onClick={()=>setLedgerPage(p=>Math.min(Math.ceil(ledger.length/LEDGER_PAGE_SIZE)-1,p+1))} disabled={(ledgerPage+1)*LEDGER_PAGE_SIZE>=ledger.length} style={ghostBtn()}>下页 →</button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══ PERFORMANCE ══ */}
        {tab === "performance" && (
          <div>
            {/* Upload */}
            <div style={card}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <div>
                  <div style={{ fontSize:17, fontWeight:700, marginBottom:4 }}>上传交易 CSV — {period}</div>
                  <div style={{ fontSize:13, color:C.muted }}>AUD（王博 + 马金斗）和 HKD（石路路）分两次上传。先选好右上角月份。</div>
                </div>
                <div style={{ display:"flex", gap:10 }}>
                  <input type="file" accept=".csv" ref={fileRef} onChange={handleFile} style={{ display:"none" }} />
                  <button onClick={() => fileRef.current?.click()} style={filledBtn()} disabled={loading}>{loading?"解析中…":"上传 CSV"}</button>
                </div>
              </div>
            </div>

            {/* Preview */}
            {preview && (
              <div style={card}>
                <div style={{ fontSize:16, fontWeight:700, marginBottom:16 }}>解析预览 — {preview.filename}</div>
                <div style={grid("1fr 1fr 1fr")}>
                  {Object.entries(preview.preview || {}).map(([tid, d]: any) => (
                    <div key={tid} style={{ background:C.bg, border:`1px solid ${C.border}`, borderRadius:10, padding:"16px 18px" }}>
                      <div style={{ fontSize:15, fontWeight:700, marginBottom:12 }}>{TRADERS[tid]?.name} <span style={{ color:C.muted, fontSize:12, fontWeight:400 }}>{tid}</span></div>
                      {[["Gross",d.gross],["Gateway",d.gateway_charge],["Exe Fee",d.exe_fee],["Sec Fee",d.sec_fee],["Currency",d.ccy]].map(([k,v])=>(
                        <div key={k as string} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",fontSize:13,borderBottom:`1px solid ${C.border}`}}>
                          <span style={{color:C.muted}}>{k}</span>
                          <span style={{fontWeight:500}}>{typeof v==="number"?v.toFixed(2):String(v)}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                {/* ── 与 daily_performance 数据对比 ── */}
                {dailyDiff && (
                  <div style={{ marginTop: 20 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>
                      与每日自动抓取数据对比
                      <span style={{ fontSize: 12, color: C.muted, fontWeight: 400, marginLeft: 8 }}>（daily_performance · {period}）</span>
                    </div>
                    <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
                      {/* 表头 */}
                      <div style={{ display: "grid", gridTemplateColumns: "100px 110px 130px 130px 100px", padding: "8px 16px", background: C.elevated, fontSize: 12, fontWeight: 700, color: C.faint, letterSpacing: 0.6 }}>
                        {["交易员", "字段", "每日抓取(累计)", "CSV上传", "差异"].map(h => <div key={h}>{h}</div>)}
                      </div>
                      {Object.entries(preview.preview || {}).flatMap(([tid, csvD]: any) => {
                        const dp = dailyDiff[tid];
                        if (!dp) return [];
                        const name = TRADERS[tid]?.name ?? tid;
                        return (["gross", "gateway_charge", "exe_fee", "trading_total"] as const).map((field, fi) => {
                          const labels: Record<string, string> = { gross: "Gross", gateway_charge: "Gateway", exe_fee: "Exe Fee", trading_total: "Trading Total" };
                          const dpVal  = dp[field] ?? 0;
                          const csvVal = csvD[field] ?? 0;
                          const diff   = csvVal - dpVal;
                          const absDiff = Math.abs(diff);
                          const diffColor = absDiff < 0.01 ? C.green : absDiff < 50 ? C.warn : C.red;
                          const diffSign  = diff >= 0 ? "+" : "";
                          return (
                            <div key={`${tid}-${field}`} style={{ display: "grid", gridTemplateColumns: "100px 110px 130px 130px 100px", padding: "8px 16px", fontSize: 13, borderTop: `1px solid ${C.border}`, background: fi === 0 ? `${C.elevated}40` : "transparent", alignItems: "center" }}>
                              <div style={{ fontWeight: fi === 0 ? 700 : 400, color: fi === 0 ? C.text : C.faint }}>{fi === 0 ? name : ""}</div>
                              <div style={{ color: C.muted }}>{labels[field]}</div>
                              <div style={{ color: C.muted }}>{dpVal.toFixed(2)}</div>
                              <div style={{ fontWeight: 600 }}>{csvVal.toFixed(2)}</div>
                              <div style={{ fontWeight: 700, color: diffColor }}>{absDiff < 0.01 ? "✓" : `${diffSign}${diff.toFixed(2)}`}</div>
                            </div>
                          );
                        });
                      })}
                    </div>
                    <div style={{ marginTop: 8, fontSize: 12, color: C.faint }}>
                      差异 &lt; 0.01 显示 ✓ · 橙色为小差异 · 红色超过 50 请核查
                    </div>
                  </div>
                )}
                {!dailyDiff && (
                  <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: 8, background: C.elevated, fontSize: 13, color: C.faint }}>
                    该月份暂无每日自动抓取数据，无法对比
                  </div>
                )}

                <div style={{ marginTop:16, display:"flex", gap:10 }}>
                  <button onClick={confirmUpload} style={filledBtn(C.green)} disabled={loading}>确认入库</button>
                  <button onClick={() => { setPreview(null); setDailyDiff(null); }} style={ghostBtn()}>取消</button>
                </div>
              </div>
            )}

            {/* Commission calc */}
            <div style={card}>
              <div style={{ fontSize:17, fontWeight:700, marginBottom:6 }}>提成计算 — {period}</div>
              <div style={{ fontSize:13, color:C.muted, marginBottom:20 }}>① 计算草稿 → ② 核对 Settlement → ③ 确认（锁定数据，发放时再写入保证金）</div>
              <div style={{ display:"flex", gap:12, marginBottom: calcResult||verify ? 20 : 0 }}>
                <button onClick={()=>handleCalc("calculate")} style={filledBtn(C.blue)} disabled={loading}>① 计算</button>
                <button onClick={()=>handleCalc("verify")}    style={filledBtn("#5B5FEB")} disabled={loading}>② 核对</button>
                <button onClick={()=>handleCalc("confirm")}   style={filledBtn(C.green)} disabled={loading}>③ 确认锁定</button>
              </div>
              {verify && (
                <div style={{ ...grid("1fr 1fr"), marginBottom:20 }}>
                  {["aud","hkd"].map(ccy => {
                    const v=verify[ccy]; const col=v.pass?C.green:C.red;
                    return (
                      <div key={ccy} style={{ background:C.bg, border:`1px solid ${col}40`, borderLeft:`3px solid ${col}`, borderRadius:10, padding:"14px 18px" }}>
                        <div style={{ fontSize:14, fontWeight:600, color:col, marginBottom:4 }}>{v.pass?"✓":"✗"} {ccy.toUpperCase()} 核对{v.pass?"通过":"有差异"}</div>
                        <div style={{ fontSize:13, color:C.muted }}>计算 {v.calculated} · PDF {v.settlement} · 差 {v.diff}</div>
                      </div>
                    );
                  })}
                </div>
              )}
              {calcResult?.results && (
                <div style={grid("1fr 1fr 1fr")}>
                  {calcResult.results.map((r: any) => {
                    const isPos=r.monthly_usd>=0; const col=isPos?C.green:C.red;
                    return (
                      <div key={r.trader_id} style={{ background:C.bg, border:`1px solid ${C.border}`, borderTop:`2px solid ${col}`, borderRadius:12, padding:"18px 20px" }}>
                        <div style={{ fontSize:15, fontWeight:700, marginBottom:14 }}>{TRADERS[r.trader_id]?.name} <span style={{ color:C.muted, fontSize:12, fontWeight:400 }}>{r.trader_id}</span></div>
                        {[
                          ["可结算NET", `${r.settle_native?.toFixed(2)} ${r.ccy||TRADERS[r.trader_id]?.ccy}`],
                          ["× 汇率 → USD", `$${r.usd_amount?.toFixed(2)}`],
                          ["平台费", `$${r.platfee_usd}`],
                        ].map(([k,v])=>(
                          <div key={k as string} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",fontSize:13,borderBottom:`1px solid ${C.border}`}}>
                            <span style={{color:C.muted}}>{k}</span><span style={{fontWeight:500}}>{v}</span>
                          </div>
                        ))}
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:12, fontWeight:700 }}>
                          <span style={{ fontSize:13 }}>每月余额</span>
                          <span style={{ fontSize:17, color:col }}>{isPos?"+":"-"}${f2(Math.abs(r.monthly_usd))} USD</span>
                        </div>
                        <div style={{ marginTop:10, paddingTop:10, borderTop:`1px solid ${C.border}`, display:"flex", justifyContent:"flex-end" }}>
                          {(() => {
                            const dbRec = commissions.find((c:any) => c.trader_id===r.trader_id && c.period===period);
                            const hasPayout = payouts.some((p:any) => p.trader_id===r.trader_id && p.period_covered?.includes(period));
                            const lbl = hasPayout ? "已发放" : dbRec?.status==="confirmed" ? "已核对" : "待确认";
                            const clr = hasPayout ? C.green : dbRec?.status==="confirmed" ? C.green : C.warn;
                            return (
                              <span style={{ fontSize:11, padding:"2px 10px", borderRadius:20, fontWeight:700, background:`${clr}22`, color:clr }}>
                                {lbl}
                              </span>
                            );
                          })()}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Trade records list */}
            <div style={{ ...card, padding:0, overflow:"hidden", marginBottom:20 }}>
              <div style={{ padding:"16px 24px", fontSize:15, fontWeight:600, borderBottom:`1px solid ${C.border}` }}>已上传交易数据</div>
              <div style={{ overflowX:"auto" }}>
                <div style={{ minWidth:1100, display:"grid", gridTemplateColumns:"90px 90px 70px 90px 110px 110px 100px 100px 160px 100px 120px", padding:"9px 24px", gap:10, fontSize:11, fontWeight:700, color:C.faint, letterSpacing:0.8, background:C.elevated, borderBottom:`1px solid ${C.border}` }}>
                  {["月份","交易员","Currency","状态","Gross","Gateway","NET","Exe Fee","Entitlements","Office Fee","业绩提成(预算)"].map(h=><div key={h}>{h}</div>)}
                </div>
                {tradeRecords.length===0&&<div style={{padding:"28px",fontSize:14,color:C.faint,textAlign:"center"}}>暂无数据，请先上传 CSV</div>}
                {tradeRecords.slice(tradePage*TRADE_PAGE_SIZE, (tradePage+1)*TRADE_PAGE_SIZE).map((r:any,i:number)=>{
                  const cfg = TRADERS[r.trader_id];
                  const net = (r.gross||0)-(r.gateway_charge||0);
                  const entLabel = r.trader_id === "LULUSHI"
                    ? "HKE 451.70 HKD"
                    : "ASX 132.22 AUD\nCHIXA 64.50 USD";
                  const officeLabel = cfg?.ccy === "AUD" ? "75.00 USD" : "—";
                  const isConfirmed = commissions.some((c:any) => c.trader_id===r.trader_id && c.period===r.period && c.status==="confirmed");
                  const stLbl = isConfirmed ? "已核对" : "待确认";
                  const stClr = isConfirmed ? C.green : C.warn;

                  // 计提提成预算计算（纯前端，不写库）
                  // 优先用当期汇率，没有则往前找最近一个有效月份
                  const sortedPf = [...periodFeesAll].sort((a:any,b:any)=>b.period.localeCompare(a.period));
                  const pf = sortedPf.find((p:any) =>
                    p.period <= r.period &&
                    (r.trader_id === "LULUSHI" ? parseFloat(p.fx_hkd_usd||0) > 0 : parseFloat(p.fx_aud_usd||0) > 0)
                  );
                  let estComm: number|null = null;
                  let fxSource: string = "";
                  // 已确认月份直接用 commission_results.monthly_usd，保持与保证金流水一致
                  const confirmedRec = commissions.find((c:any) => c.trader_id===r.trader_id && c.period===r.period && c.status==="confirmed");
                  if (confirmedRec) {
                    estComm = parseFloat(confirmedRec.monthly_usd || 0);
                    fxSource = "";
                  } else if (pf) {
                    // 未确认月份：用公式预算
                    fxSource = pf.period !== r.period ? ` (参考${pf.period})` : "";
                    if (r.trader_id === "LULUSHI") {
                      const fx = parseFloat(pf.fx_hkd_usd);
                      const hke = parseFloat(pf.hke_hkd ?? 451.70);
                      const base = net * 1.0;
                      const settleN = base - (r.exe_fee||0) - hke;
                      estComm = settleN * fx;
                    } else {
                      const fx = parseFloat(pf.fx_aud_usd);
                      const asx = parseFloat(pf.asx_aud ?? 264.44) / 2;
                      const chixa = parseFloat(pf.chixa_usd ?? 129.0) / 2;
                      const base = net * 0.80;
                      const ent = asx + chixa / fx;
                      const settleN = base - (r.exe_fee||0) - ent;
                      estComm = settleN * fx - 75;
                    }
                  }

                  return (
                    <div key={r.id||i} style={{minWidth:1100,display:"grid",gridTemplateColumns:"90px 90px 70px 90px 110px 110px 100px 100px 160px 100px 120px",padding:"12px 24px",gap:10,borderBottom:`1px solid ${C.border}`,background:i%2?`${C.elevated}60`:"transparent",alignItems:"center",fontSize:13}}>
                      <div style={{color:C.muted}}>{r.period}</div>
                      <div style={{fontWeight:600}}>{cfg?.name||r.trader_id}</div>
                      <div style={{color:C.muted}}>{r.ccy}</div>
                      <span style={{fontSize:11,padding:"2px 8px",borderRadius:10,fontWeight:700,background:`${stClr}22`,color:stClr}}>{stLbl}</span>
                      <div>{r.gross!=null?r.gross.toFixed(2):"—"}</div>
                      <div style={{color:C.red}}>{r.gateway_charge!=null?`-${r.gateway_charge.toFixed(2)}`:"—"}</div>
                      <div style={{fontWeight:600,color:net>=0?C.green:C.red}}>{net.toFixed(2)}</div>
                      <div style={{color:C.red}}>{r.exe_fee!=null?`-${r.exe_fee.toFixed(2)}`:"—"}</div>
                      <div style={{color:C.warn,fontSize:12,lineHeight:1.6,whiteSpace:"pre-line"}}>{entLabel}</div>
                      <div style={{color:C.warn}}>{officeLabel}</div>
                      <div style={{fontWeight:700, color: estComm==null ? C.faint : estComm>=0 ? C.green : C.red}}>
                        {estComm==null
                          ? <span style={{color:C.faint,fontSize:12}}>无历史汇率</span>
                          : <>{`${estComm>=0?"+":"-"}$${f2(Math.abs(estComm))}`}{fxSource&&<span style={{fontSize:11,color:C.faint,fontWeight:400,display:"block"}}>{fxSource}</span>}</>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            {/* Trade records pagination */}
            {tradeRecords.length > TRADE_PAGE_SIZE && (
              <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:10, padding:"12px 0", marginBottom:4 }}>
                <button onClick={()=>setTradePage(p=>Math.max(0,p-1))} disabled={tradePage===0} style={ghostBtn()}>← 上页</button>
                <span style={{fontSize:13,color:C.muted}}>第 {tradePage+1} / {Math.ceil(tradeRecords.length/TRADE_PAGE_SIZE)} 页 · 共 {tradeRecords.length} 条</span>
                <button onClick={()=>setTradePage(p=>Math.min(Math.ceil(tradeRecords.length/TRADE_PAGE_SIZE)-1,p+1))} disabled={(tradePage+1)*TRADE_PAGE_SIZE>=tradeRecords.length} style={ghostBtn()}>下页 →</button>
              </div>
            )}
          </div>
        )}

        {/* ══ SETTLEMENT ══ */}
        {tab === "settlement" && settlView === "list" && (
          <div>
            {/* ── Monthly Profit Summary + ERP Ledger ── */}
            {(() => {
              // ── 利润计算（简单公式）──
              const sortedPfAll = [...periodFeesAll].sort((a:any,b:any)=>b.period.localeCompare(a.period));
              const profitRows = settlements.filter((s: any) => s.period >= "2026-01").map((s: any) => {
                // Priority 1: payment_exchange USD to_amount sum（手动补录或PDF解析的最终确认值）
                const peUsdTotal = (s.payment_exchange ?? [])
                  .filter((r:any) => r.to_ccy === "USD" && parseFloat(r.to_amount || 0) > 0)
                  .reduce((sum:number, r:any) => sum + parseFloat(r.to_amount || 0), 0);
                // Priority 2: post_exchange_usd（PDF 原始字段）
                let postUsd: number | null = peUsdTotal > 0 ? peUsdTotal
                  : s.post_exchange_usd != null ? parseFloat(s.post_exchange_usd)
                  : null;
                let postUsdSource: "pe" | "pdf" | "est" = peUsdTotal > 0 ? "pe"
                  : (s.post_exchange_usd != null && parseFloat(s.post_exchange_usd) > 0) ? "pdf"
                  : "est";
                // Priority 3: post_exchange_aud × fxAud（4月类型：PDF 里 AUD 尚未换汇）
                if (!postUsd || postUsd === 0) {
                  const pf = sortedPfAll.find((p:any) => p.period === s.period);
                  const fxAud = pf ? parseFloat(pf.fx_aud_usd || 0) : 0;
                  if (fxAud > 0) {
                    const peAud = s.post_exchange_aud != null ? parseFloat(s.post_exchange_aud) : 0;
                    if (peAud > 0) {
                      postUsd = Math.round(peAud * fxAud * 100) / 100; postUsdSource = "est";
                    } else {
                      // 最终兜底：用 Grand Total AUD（equity - expenses 近似）
                      const audUsedInLc = (s.loss_coverage ?? []).filter((r:any)=>r.from_ccy==="AUD").reduce((sum:number,r:any)=>sum+(r.from_amount||0),0);
                      const postExchAud = Math.max(0, (s.equity_aud||0) - audUsedInLc);
                      if (postExchAud > 0) { postUsd = Math.round(postExchAud * fxAud * 100) / 100; postUsdSource = "est"; }
                    }
                  }
                }
                const wireFees = parseFloat(s.wire_fees_usd ?? "0");
                const periodComms = commissions.filter((c:any) => c.period === s.period);
                const monthlyComm = periodComms.reduce((sum:number, c:any) => {
                  const val = parseFloat(c.monthly_usd || 0);
                  const reserve = TRADERS[c.trader_id]?.reserve ?? 0;
                  // Balance at end of this period (all ledger entries up to period end)
                  const balAtPeriod = ledger
                    .filter((e:any) => e.trader_id === c.trader_id && (e.entry_date||"") <= `${s.period}-31`)
                    .reduce((s2:number, e:any) => s2 + parseFloat(e.amount_usd || 0), 0);
                  const canWithdraw = balAtPeriod > reserve;
                  // If eligible: count full amount; if not: only count losses (negative = room's loss)
                  return sum + (canWithdraw ? val : Math.min(0, val));
                }, 0);
                const roomProfit  = postUsd != null
                  ? Math.round((postUsd - monthlyComm - wireFees) * 10000) / 10000
                  : null;
                return { period: s.period, postUsd, postUsdSource, wireFees, monthlyComm, roomProfit, s };
              });
              const totalProfit = profitRows.reduce((sum, r) => sum + (r.roomProfit ?? 0), 0);
              const hasAnyProfit = profitRows.some(r => r.roomProfit != null);

              // ── ERP 台账余额计算 ──
              const erpSorted = [...erpLedger].sort((a,b) => a.entry_date.localeCompare(b.entry_date) || a.id - b.id);
              let erpBal = 0;
              const erpWithBal = erpSorted.map(e => {
                erpBal += parseFloat(e.amount_usd);
                return { ...e, _bal: Math.round(erpBal * 10000) / 10000 };
              });
              const erpCurrentBal = erpBal;
              const erpDisplay = [...erpWithBal].reverse();
              const ERP_TYPE: Record<string,string> = { initial:"初始余额", settlement_deposit:"Settlement 转入", bank_deposit:"银行存入", withdrawal:"提取" };

              return (
                <div style={{display:"flex", gap:16, marginBottom:20, alignItems:"flex-start"}}>

                  {/* ── 利润汇总 ── */}
                  <div style={{...card, padding:0, overflow:"hidden", flex:"1 1 0", minWidth:0}}>
                    <div style={{padding:"16px 24px", borderBottom:`1px solid ${C.border}`, display:"flex", justifyContent:"space-between", alignItems:"center"}}>
                      <div style={{fontSize:15, fontWeight:700}}>交易室月度利润汇总</div>
                      {hasAnyProfit && (
                        <div style={{textAlign:"right"}}>
                          <div style={{fontSize:11, color:C.faint, marginBottom:2}}>累计净利</div>
                          <div style={{fontSize:22, fontWeight:800, color:totalProfit>=0?C.green:C.red}}>
                            {totalProfit>=0?"+":"-"}${f2(Math.abs(totalProfit))} USD
                          </div>
                        </div>
                      )}
                    </div>
                    <div style={{display:"grid", gridTemplateColumns:"80px 1fr 90px 110px 110px", padding:"9px 20px", gap:10, fontSize:11, fontWeight:700, color:C.faint, letterSpacing:0.8, background:C.elevated, borderBottom:`1px solid ${C.border}`}}>
                      {["月份","Post Exchange","Wire Fee","计提提成","利润"].map(h=><div key={h}>{h}</div>)}
                    </div>
                    {profitRows.length === 0 && <div style={{padding:"28px", textAlign:"center", color:C.faint, fontSize:13}}>暂无 Settlement 数据</div>}
                    {profitRows.map((r, i) => {
                      const pos = (r.roomProfit ?? 0) >= 0;
                      const col = r.roomProfit == null ? C.faint : pos ? C.green : C.red;
                      return (
                        <div key={r.period}
                          onClick={()=>{ setSForm({ period:r.s.period, equity_aud:r.s.equity_aud?.toString()??"", cut_aud:r.s.cut_aud?.toString()??"", net_aud:r.s.net_aud?.toString()??"", exe_aud:r.s.exe_aud?.toString()??"", equity_hkd:r.s.equity_hkd?.toString()??"", cut_hkd:r.s.cut_hkd?.toString()??"", net_hkd:r.s.net_hkd?.toString()??"", exe_hkd:r.s.exe_hkd?.toString()??"", post_exchange_aud:r.s.post_exchange_aud?.toString()??"", post_exchange_hkd:r.s.post_exchange_hkd?.toString()??"", post_exchange_usd:r.s.post_exchange_usd?.toString()??"", wire_fees_usd:r.s.wire_fees_usd?.toString()??"", fx_notes:r.s.fx_notes??"", loss_coverage:r.s.loss_coverage??[], payment_exchange:r.s.payment_exchange??[], erp_deposits:r.s.erp_deposits??[], erp_withdrawals:r.s.erp_withdrawals??[] }); setSettlView("edit"); }}
                          style={{display:"grid", gridTemplateColumns:"80px 1fr 90px 110px 110px", padding:"12px 20px", gap:10, borderBottom:`1px solid ${C.border}`, background:i%2?`${C.elevated}60`:"transparent", alignItems:"center", cursor:"pointer", fontSize:13}}>
                          <div style={{fontWeight:700}}>{r.period}</div>
                          <div style={{color:C.muted}}>
                            {r.postUsd!=null ? (
                              <span>
                                ${f2(r.postUsd)}
                                {r.postUsdSource === "pe"
                                  ? <span style={{fontSize:10,color:C.blue,marginLeft:4}}>⚡兑换确认</span>
                                  : r.postUsdSource === "est"
                                    ? <span style={{fontSize:10,color:C.warn,marginLeft:4}}>~AUD换算</span>
                                    : null}
                              </span>
                            ) : "—"}
                          </div>
                          <div style={{color:C.red, fontSize:12}}>{r.wireFees>0?`-$${f2(r.wireFees)}`:"—"}</div>
                          <div style={{fontSize:12}}>
                            <span style={{color:C.blue}}>{r.monthlyComm!==0?`-$${f2(r.monthlyComm)}`:"—"}</span>
                          </div>
                          <div style={{fontWeight:700, color:col}}>
                            {r.roomProfit==null
                              ? <span style={{color:C.faint, fontSize:11}}>缺 Post Exchange</span>
                              : `${pos?"+":"-"}$${f2(Math.abs(r.roomProfit))}`}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* ── ERP 台账 ── */}
                  <div style={{...card, padding:0, overflow:"hidden", flex:"1 1 0", minWidth:0}}>
                    <div style={{padding:"16px 20px", borderBottom:`1px solid ${C.border}`, display:"flex", justifyContent:"space-between", alignItems:"center"}}>
                      <div style={{fontSize:15, fontWeight:700}}>ERP 账户</div>
                      <div style={{fontSize:20, fontWeight:800, color:erpCurrentBal>=0?C.blue:C.red}}>
                        ${f2(erpCurrentBal)}
                      </div>
                    </div>

                    {/* 录入表单 */}
                    <div style={{padding:"14px 16px", borderBottom:`1px solid ${C.border}`, background:`${C.elevated}60`}}>
                      <div style={{display:"flex", gap:8, marginBottom:8, flexWrap:"wrap"}}>
                        <input type="date" style={{...inp, flex:"0 0 auto", width:130, padding:"7px 10px", fontSize:13}}
                          value={erpForm.entry_date} onChange={e=>setErpForm(f=>({...f,entry_date:e.target.value}))} />
                        <select style={{...inp, flex:"0 0 auto", width:150, padding:"7px 10px", fontSize:13}}
                          value={erpForm.type} onChange={e=>setErpForm(f=>({...f,type:e.target.value}))}>
                          <option value="initial">初始余额</option>
                          <option value="settlement_deposit">Settlement 转入</option>
                          <option value="bank_deposit">银行存入</option>
                          <option value="withdrawal">提取</option>
                        </select>
                        <input type="number" step="0.01" placeholder="金额 USD" style={{...inp, flex:1, minWidth:80, padding:"7px 10px", fontSize:13}}
                          value={erpForm.amount_usd} onChange={e=>setErpForm(f=>({...f,amount_usd:e.target.value}))} />
                      </div>
                      <div style={{display:"flex", gap:8}}>
                        {erpForm.type === "settlement_deposit" && (
                          <input type="text" placeholder="关联月份 如 2026-05" style={{...inp, flex:"0 0 auto", width:160, padding:"7px 10px", fontSize:13}}
                            value={erpForm.settlement_period} onChange={e=>setErpForm(f=>({...f,settlement_period:e.target.value}))} />
                        )}
                        <input type="text" placeholder="备注" style={{...inp, flex:1, padding:"7px 10px", fontSize:13}}
                          value={erpForm.note} onChange={e=>setErpForm(f=>({...f,note:e.target.value}))} />
                        <button onClick={saveErpEntry} style={{...filledBtn(), padding:"7px 16px", fontSize:13, whiteSpace:"nowrap"}} disabled={loading}>+ 添加</button>
                      </div>
                    </div>

                    {/* 台账列表 */}
                    {erpDisplay.length === 0 ? (
                      <div style={{padding:"24px", textAlign:"center", color:C.faint, fontSize:13}}>暂无记录，请先录入初始余额</div>
                    ) : (
                      <>
                        <div style={{display:"grid", gridTemplateColumns:"90px 110px 90px 90px 28px", padding:"8px 14px", gap:8, fontSize:11, fontWeight:700, color:C.faint, letterSpacing:0.8, background:C.elevated, borderBottom:`1px solid ${C.border}`}}>
                          {["日期","类型","金额","余额",""].map(h=><div key={h}>{h}</div>)}
                        </div>
                        {erpDisplay.map((e:any, i:number) => {
                          const amt = parseFloat(e.amount_usd);
                          const isWd = amt < 0;
                          return (
                            <div key={e.id} style={{display:"grid", gridTemplateColumns:"90px 110px 90px 90px 28px", padding:"10px 14px", gap:8, borderBottom:`1px solid ${C.border}`, background:i%2?`${C.elevated}60`:"transparent", alignItems:"center", fontSize:13}}>
                              <div style={{color:C.muted, fontSize:12}}>{e.entry_date}{e.settlement_period?<div style={{color:C.faint,fontSize:10}}>{e.settlement_period}</div>:null}</div>
                              <div style={{fontSize:12}}>{ERP_TYPE[e.type]??e.type}{e.note?<div style={{color:C.faint,fontSize:10,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{e.note}</div>:null}</div>
                              <div style={{fontWeight:700, color:isWd?C.red:C.green}}>{isWd?"-":"+"}${f2(Math.abs(amt))}</div>
                              <div style={{fontWeight:700}}>${f2(e._bal)}</div>
                              <button onClick={()=>deleteErpEntry(e.id)} style={{background:"transparent",border:`1px solid ${C.border}`,color:C.faint,cursor:"pointer",borderRadius:6,fontSize:12,width:26,height:26,display:"flex",alignItems:"center",justifyContent:"center"}} disabled={loading}>×</button>
                            </div>
                          );
                        })}
                      </>
                    )}
                  </div>

                </div>
              );
            })()}

            {/* ── 左右分栏：Settlement 列表 1/3 + 交易数据 2/3 ── */}
            <div style={{ display:"flex", gap:16, alignItems:"flex-start" }}>

              {/* 左：Settlement 月份列表 */}
              <div style={{ flex:"0 0 23%", minWidth:0 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12, gap:8 }}>
                  <div style={{ fontSize:14, fontWeight:600, color:C.muted, flexShrink:0 }}>Settlement 记录</div>
                  <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap" as const }}>
                    <select value={period} onChange={e => setPeriod(e.target.value)} style={{ ...inp, width:110, padding:"5px 10px", fontSize:13 }}>
                      {MONTHS.map(p => <option key={p}>{p}</option>)}
                    </select>
                    <button onClick={triggerSettlFetch} style={{...ghostBtn(), fontSize:12, padding:"5px 9px"}} disabled={fetchingSettl}>
                      {fetchingSettl ? "抓取…" : "↓ 抓取"}
                    </button>
                    <button onClick={() => { setSForm({...emptySForm, period}); setSettlView("edit"); }} style={{...ghostBtn(), fontSize:12, padding:"5px 9px", whiteSpace:"nowrap"}}>+ 新建</button>
                  </div>
                </div>
                {settlements.length===0 && <div style={{...card, textAlign:"center", color:C.faint, fontSize:13, padding:"32px"}}>暂无记录</div>}
                {settlements.map((s:any) => {
                  const isSelected = selectedSettlPeriod === s.period;
                  return (
                    <div key={s.period}
                      style={{ ...card, cursor:"pointer", marginBottom:8, padding:"12px 16px",
                        borderColor: isSelected ? C.blue : C.border,
                        borderLeft: `3px solid ${isSelected ? C.blue : "transparent"}`,
                        background: isSelected ? `${C.blue}10` : C.surface }}
                      onClick={() => setSelectedSettlPeriod(isSelected ? null : s.period)}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                        <div style={{ fontSize:15, fontWeight:700 }}>{s.period}</div>
                        <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                          {s.payment_exchange?.length>0 && <span style={{fontSize:10, color:C.blue}}>⚡汇率</span>}
                          <button onClick={e => { e.stopPropagation();
                            setSForm({ period:s.period, equity_aud:s.equity_aud?.toString()??"", cut_aud:s.cut_aud?.toString()??"", net_aud:s.net_aud?.toString()??"", exe_aud:s.exe_aud?.toString()??"", equity_hkd:s.equity_hkd?.toString()??"", cut_hkd:s.cut_hkd?.toString()??"", net_hkd:s.net_hkd?.toString()??"", exe_hkd:s.exe_hkd?.toString()??"", post_exchange_aud:s.post_exchange_aud?.toString()??"", post_exchange_hkd:s.post_exchange_hkd?.toString()??"", post_exchange_usd:s.post_exchange_usd?.toString()??"", wire_fees_usd:s.wire_fees_usd?.toString()??"", fx_notes:s.fx_notes??"", loss_coverage:s.loss_coverage??[], payment_exchange:s.payment_exchange??[], erp_deposits:s.erp_deposits??[], erp_withdrawals:s.erp_withdrawals??[] });
                            setSettlView("edit");
                          }} style={{...ghostBtn(), fontSize:11, padding:"3px 8px"}}>编辑</button>
                        </div>
                      </div>
                      <div style={{ fontSize:11, color:C.faint, marginTop:4, display:"flex", gap:12, flexWrap:"wrap" as const }}>
                        <span>AUD {s.equity_aud!=null?f2(s.equity_aud):"—"}</span>
                        <span>HKD {s.equity_hkd!=null?f2(Math.abs(s.equity_hkd)):"—"}</span>
                        {(() => {
                          const peTot = (s.payment_exchange ?? []).filter((r:any) => r.to_ccy==="USD" && parseFloat(r.to_amount||0)>0).reduce((sum:number,r:any)=>sum+parseFloat(r.to_amount||0),0);
                          const dispUsd = peTot > 0 ? peTot : (s.post_exchange_usd != null ? parseFloat(s.post_exchange_usd) : null);
                          return <span>Post {dispUsd!=null?`$${f2(dispUsd)}`:"—"}{peTot>0?<span style={{fontSize:9,color:C.blue,marginLeft:2}}>⚡</span>:null}</span>;
                        })()}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 右：已上传交易数据 */}
              <div style={{ flex:1, minWidth:0 }}>
                {!selectedSettlPeriod ? (
                  <div style={{ ...card, textAlign:"center", color:C.faint, fontSize:13, padding:"60px 24px" }}>
                    ← 点击左侧月份查看交易数据
                  </div>
                ) : (() => {
                  const sp = selectedSettlPeriod;
                  const spTrades = tradeRecords.filter((r:any) => r.period === sp);
                  const spComms  = commissions.filter((c:any) => c.period === sp);
                  // 有月度 CSV 用 CSV；没 CSV 但有已核对结果时，用 commission_results 兜底显示
                  const displayRows = spTrades.length > 0
                    ? spTrades
                    : spComms.map((c:any) => ({ id:`c-${c.trader_id}`, trader_id:c.trader_id, gross:null, gateway_charge:null, exe_fee:null, net_native:c.net_native, _fromComm:true }));
                  const isConfirmedPeriod = spComms.some((c:any) => c.status === "confirmed");
                  const sortedPfSp = [...periodFeesAll].sort((a:any,b:any) => b.period.localeCompare(a.period));
                  const pfSp = sortedPfSp.find((p:any) => p.period <= sp && (parseFloat(p.fx_aud_usd||0)>0));
                  const fxSp = pfSp ? parseFloat(pfSp.fx_aud_usd) : 0;

                  return (
                    <div>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
                        <div style={{ fontSize:14, fontWeight:600 }}>
                          {sp} 交易数据
                          <span style={{ marginLeft:8, fontSize:11, padding:"2px 8px", borderRadius:10,
                            background: isConfirmedPeriod ? `${C.green}22` : `${C.warn}22`,
                            color: isConfirmedPeriod ? C.green : C.warn, fontWeight:700 }}>
                            {isConfirmedPeriod ? "已核对" : "待确认"}
                          </span>
                        </div>
                        {/* 一键结算按钮 */}
                        {!isConfirmedPeriod && (
                          <button
                            style={{ ...filledBtn(C.blue), fontSize:13, display:"flex", alignItems:"center", gap:6 }}
                            disabled={settling}
                            onClick={async () => {
                              setSettling(true);
                              showToast(`正在下载 ${sp} 结算数据...`);
                              try {
                                // 下载 PDF
                                const pdfUrl = `https://metro.dttw.com/metro/download-past-settlement-pdf/1232/${sp}`;
                                const resp = await fetch(pdfUrl, { credentials: "include" });
                                if (!resp.ok) throw new Error("PDF 下载失败，请确认已在 DTTW 完成结算操作");
                                const blob = await resp.blob();
                                const file = new File([blob], `settlement-${sp}.pdf`, { type:"application/pdf" });
                                const parsed = await parsePdf(file);
                                const parsedPe = parsed.payment_exchange ?? [];
                                const savedPe = settlements.find((s:any) => s.period === sp)?.payment_exchange ?? [];
                                const currentPe = hasPaymentExchange(savedPe) ? savedPe : ((sForm.period || period) === sp ? sForm.payment_exchange ?? [] : []);
                                const peDiff = paymentExchangeDiffers(currentPe, parsedPe);
                                setSForm((prev:any) => {
                                  const prevPe = (prev.period || period) === sp ? prev.payment_exchange : [];
                                  const finalPe = hasPaymentExchange(savedPe) ? savedPe : (hasPaymentExchange(prevPe) ? prevPe : parsedPe);
                                  return { period:sp, equity_aud:parsed.equity_aud?.toString()??"", cut_aud:parsed.cut_aud?.toString()??"", net_aud:parsed.net_aud?.toString()??"", exe_aud:parsed.exe_aud?.toString()??"", equity_hkd:parsed.equity_hkd?.toString()??"", cut_hkd:parsed.cut_hkd?.toString()??"", net_hkd:parsed.net_hkd?.toString()??"", exe_hkd:parsed.exe_hkd?.toString()??"", post_exchange_usd:parsed.post_exchange_usd?.toString()??"", wire_fees_usd:parsed.wire_fees_usd?.toString()??"", fx_notes:"", loss_coverage:parsed.loss_coverage??[], payment_exchange:finalPe, erp_deposits:parsed.erp_deposits??[], erp_withdrawals:parsed.erp_withdrawals??[] };
                                });
                                setSettlView("edit");
                                showToast(peDiff ? "PDF Payment Exchange 与当前已确认值不同，已保留当前值" : "PDF 解析完成，请核对后保存");
                              } catch(e:any) {
                                showToast(e.message || "结算失败", false);
                              }
                              setSettling(false);
                            }}>
                            {settling ? "处理中..." : `⚡ 一键结算 ${sp}`}
                          </button>
                        )}
                      </div>

                      {displayRows.length === 0 ? (
                        <div style={{ ...card, textAlign:"center", color:C.faint, fontSize:13, padding:"40px" }}>
                          该月暂无数据
                        </div>
                      ) : (
                        <div style={{ ...card, padding:0, overflow:"hidden" }}>
                          <div style={{ overflowX:"auto" }}>
                            <div style={{ minWidth:1000, display:"grid", gridTemplateColumns:"90px 70px 90px 110px 110px 100px 160px 100px 120px", padding:"8px 16px", gap:8, fontSize:11, fontWeight:700, color:C.faint, letterSpacing:0.8, background:C.elevated, borderBottom:`1px solid ${C.border}` }}>
                              {["交易员","状态","Gross","Gateway","NET","Exe Fee","Entitlements","Office Fee","业绩提成(预算)"].map(h=><div key={h}>{h}</div>)}
                            </div>
                            {displayRows.map((r:any, i:number) => {
                              const cfg = TRADERS[r.trader_id];
                              const net = r._fromComm ? (parseFloat(r.net_native)||0) : (r.gross||0)-(r.gateway_charge||0);
                              const comm = spComms.find((c:any) => c.trader_id === r.trader_id);
                              const isConf = comm?.status === "confirmed";
                              const estComm = comm?.monthly_usd != null ? parseFloat(comm.monthly_usd) : null;
                              const entLabel = r.trader_id === "LULUSHI" ? "HKE 451.70 HKD" : "ASX 132.22 AUD\nCHIXA 64.50 USD";
                              const officeLabel = cfg?.ccy === "AUD" ? "75.00 USD" : "—";
                              return (
                                <div key={r.id||i} style={{ minWidth:1000, display:"grid", gridTemplateColumns:"90px 70px 110px 110px 110px 100px 160px 100px 120px", padding:"10px 16px", gap:8, borderBottom:`1px solid ${C.border}`, background:i%2?`${C.elevated}60`:"transparent", fontSize:13, alignItems:"center" }}>
                                  <div style={{ fontWeight:600 }}>{cfg?.name||r.trader_id}</div>
                                  <span style={{ fontSize:10, padding:"2px 6px", borderRadius:8, fontWeight:700, background:isConf?`${C.green}22`:`${C.warn}22`, color:isConf?C.green:C.warn }}>{isConf?"已核对":"待确认"}</span>
                                  <div style={{ color:r._fromComm?C.faint:(r.gross||0)>=0?C.green:C.red }}>{r._fromComm ? "—" : (r.gross||0).toFixed(2)}</div>
                                  <div style={{ color:C.red }}>{r.gateway_charge!=null?`-${r.gateway_charge.toFixed(2)}`:"—"}</div>
                                  <div style={{ fontWeight:600, color:net>=0?C.green:C.red }}>{net.toFixed(2)}</div>
                                  <div style={{ color:C.red }}>{r.exe_fee!=null?`-${r.exe_fee.toFixed(2)}`:"—"}</div>
                                  <div style={{ color:C.warn, fontSize:11, whiteSpace:"pre-line" as const }}>{entLabel}</div>
                                  <div style={{ color:C.warn }}>{officeLabel}</div>
                                  <div style={{ fontWeight:700, color:estComm==null?C.faint:estComm>=0?C.green:C.red }}>
                                    {estComm==null?"—":`${estComm>=0?"+":"-"}$${f2(Math.abs(estComm))}`}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        )}

        {tab === "settlement" && settlView === "edit" && (
          <div>
            <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:20 }}>
              <button onClick={()=>setSettlView("list")} style={ghostBtn()}>← 返回</button>
              <div style={{ fontSize:17, fontWeight:700 }}>{sForm.period||period} Settlement</div>
            </div>

            {/* Structural Profit Analysis — removed per user request */}
            {false && (() => {
              const p = sForm.period || period;
              const periodTrades = tradeRecords.filter((r:any) => r.period === p);

              const audPe = sForm.payment_exchange?.find((r:any) => r.from_ccy === "AUD" && r.to_ccy === "USD");
              const hkdPe = sForm.payment_exchange?.find((r:any) => r.from_ccy === "HKD" && r.to_ccy === "USD");
              const fx_aud = audPe ? parseFloat(audPe.rate) : parseFloat(fForm.fx_aud_usd) || 0;
              const fx_hkd = hkdPe ? parseFloat(hkdPe.rate) : parseFloat(fForm.fx_hkd_usd) || 0.12451659;

              if (!periodTrades.length || !fx_aud) return (
                <div style={{ ...card, borderColor:`${C.faint}40`, color:C.faint, fontSize:13, textAlign:"center", padding:"20px" }}>
                  交易室利润分析：需要该月 CSV 数据 + Settlement 含 Payment Exchange 汇率
                </div>
              );

              const ASX=264.44, CHIXA=129.00, HKE=451.70;

              // Per-trader: use commission_results (monthly_usd) + balance eligibility check
              const periodCommsP = commissions.filter((c:any) => c.period === p);
              const wireFees     = parseFloat(sForm.wire_fees_usd || "0");
              const postExch     = parseFloat(sForm.post_exchange_usd || "0");

              const rows = periodTrades.map((t:any) => {
                const comm        = periodCommsP.find((c:any) => c.trader_id === t.trader_id);
                const monthlyUsd  = comm ? parseFloat(comm.monthly_usd || 0) : 0;
                const settleN     = comm ? parseFloat(comm.settle_native || 0) : 0;
                const ccy         = TRADERS[t.trader_id]?.ccy || "?";
                const reserve     = TRADERS[t.trader_id]?.reserve ?? 0;
                const balAtP      = ledger
                  .filter((e:any) => e.trader_id === t.trader_id && (e.entry_date||"") <= `${p}-31`)
                  .reduce((s2:number, e:any) => s2 + parseFloat(e.amount_usd || 0), 0);
                const canWithdraw = balAtP > reserve;
                const cost        = canWithdraw ? monthlyUsd : Math.min(0, monthlyUsd);
                return { trader_id: t.trader_id, ccy, settleN, monthlyUsd, canWithdraw, cost };
              });

              const totalCost  = rows.reduce((s,r) => s + r.cost, 0);
              const totalProfit = postExch - totalCost - wireFees;
              const isProfit    = totalProfit >= 0;

              return (
                <div style={{ ...card, borderColor:`${isProfit?C.green:C.red}40`, borderLeft:`3px solid ${isProfit?C.green:C.red}` }}>
                  {/* Header */}
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:20 }}>
                    <div>
                      <div style={{ fontSize:15, fontWeight:700, marginBottom:4 }}>交易室利润分析 — {p}</div>
                      <div style={{ fontSize:12, color:C.muted }}>
                        AUD/USD {fx_aud.toFixed(6)} · HKD/USD {fx_hkd.toFixed(6)}
                      </div>
                    </div>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontSize:11, color:C.faint, marginBottom:2 }}>本月交易室净利</div>
                      <div style={{ fontSize:30, fontWeight:800, color:isProfit?C.green:C.red }}>
                        {isProfit?"+":"-"}${f2(Math.abs(totalProfit))}
                      </div>
                      <div style={{ fontSize:12, color:C.faint }}>USD</div>
                    </div>
                  </div>

                  {/* Summary bar */}
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:10, marginBottom:20, background:C.elevated, borderRadius:10, padding:"14px 16px" }}>
                    {([
                      ["Post Exchange", postExch>0?`+$${f2(postExch)}`:"—", C.green],
                      ["计提提成", totalCost!==0?`-$${f2(Math.abs(totalCost))}`:"—", C.red],
                      ["Wire Fee", wireFees>0?`-$${f2(wireFees)}`:"—", C.red],
                      ["交易室净利", `${isProfit?"+":"-"}$${f2(Math.abs(totalProfit))}`, isProfit?C.green:C.red],
                    ] as [string,string,string][]).map(([label,val,col])=>(
                      <div key={label} style={{ textAlign:"center" }}>
                        <div style={{ fontSize:11, color:C.faint, marginBottom:6 }}>{label}</div>
                        <div style={{ fontSize:17, fontWeight:700, color:col }}>{val}</div>
                      </div>
                    ))}
                  </div>

                  {/* Per-trader cards */}
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12 }}>
                    {rows.map((r:any) => {
                      const isPos = r.monthlyUsd >= 0;
                      return (
                        <div key={r.trader_id} style={{ background:C.elevated, borderRadius:10, padding:"14px 16px" }}>
                          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
                            <div style={{ fontSize:13, fontWeight:700 }}>{TRADERS[r.trader_id]?.name}</div>
                            <div style={{ fontSize:11, color:C.faint }}>{r.settleN.toFixed(2)} {r.ccy} NET</div>
                          </div>
                          <div style={{ display:"flex", justifyContent:"space-between", padding:"5px 0", fontSize:12, borderBottom:`1px solid ${C.border}` }}>
                            <span style={{ color:C.faint }}>业绩提成</span>
                            <span style={{ color:isPos?C.blue:C.red, fontWeight:600 }}>
                              {r.monthlyUsd!==0?`${isPos?"+":"-"}$${f2(Math.abs(r.monthlyUsd))}`:"—"}
                            </span>
                          </div>
                          <div style={{ display:"flex", justifyContent:"space-between", padding:"5px 0", fontSize:12 }}>
                            <span style={{ color:C.faint }}>计入利润</span>
                            <span style={{ color:r.canWithdraw?(r.cost>=0?C.blue:C.red):C.faint, fontWeight:600 }}>
                              {r.canWithdraw
                                ? (r.cost!==0?`${r.cost>=0?"+":"-"}$${f2(Math.abs(r.cost))}`:"—")
                                : (r.cost<0?`-$${f2(Math.abs(r.cost))}`:"未达门槛")}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {!isProfit && (
                    <div style={{ marginTop:14, fontSize:13, color:C.warn, background:`${C.warn}10`, padding:"10px 14px", borderRadius:8 }}>
                      ⚠ 本月亏损，通常因石路路盈利较高（100% 费率：交易室倒贴 NET×15%）
                    </div>
                  )}
                </div>
              );
            })()}
            {/* 上传截图 / PDF —— OCR 识别 & PDF 核对入口 */}
            <div style={{...card, borderColor:`${C.blue}40`}}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap" as const, gap:10 }}>
                <div>
                  <div style={{ fontSize:15, fontWeight:700, marginBottom:4 }}>上传截图 / PDF 自动识别</div>
                  <div style={{ fontSize:13, color:C.muted }}>上传 Settlement 截图用 OCR 识别自动填入，或上传 PDF 核对数据一致性。</div>
                </div>
                <div style={{ display:"flex", gap:10, alignItems:"center" }}>
                  {pdfParsing && <span style={{fontSize:13,color:C.blue}}>解析中…</span>}
                  {settlementMatchStatus && (
                    <span style={{ fontSize:12, padding:"4px 12px", borderRadius:6, background: settlementMatchStatus.match ? `${C.green}22` : `${C.red}22`, color: settlementMatchStatus.match ? C.green : C.red, fontWeight:700 }}>
                      {settlementMatchStatus.match ? "✓ 数据匹配" : `✗ ${settlementMatchStatus.differences.length} 项差异`}
                    </span>
                  )}
                  <input type="file" accept="image/*" onChange={(e)=>{ if(e.target.files?.[0]) handleImgUpload(e as any); }} style={{display:"none"}} id="img-upload-input" />
                  <input type="file" accept=".pdf" onChange={handlePdfUpload} style={{display:"none"}} id="pdf-upload-input" />
                  <button onClick={()=>(document.getElementById("img-upload-input") as HTMLInputElement)?.click()} style={ghostBtn()}>🖼 上传截图</button>
                  <button onClick={()=>(document.getElementById("pdf-upload-input") as HTMLInputElement)?.click()} style={filledBtn(C.blue)} disabled={pdfParsing}>📄 上传 PDF</button>
                  <button onClick={()=>{ setSForm({...emptySForm, period}); setSettlImg(null); setSettlementMatchStatus(null); }} style={ghostBtn()}>清空</button>
                </div>
              </div>
              {settlImg && (
                <div style={{ position:"relative", marginTop:16 }}>
                  <img src={settlImg} alt="settlement" style={{ width:"100%", borderRadius:8, border:`1px solid ${C.border}`, maxHeight:500, objectFit:"contain", background:"#000" }} />
                  <button onClick={()=>setSettlImg(null)} style={{ position:"absolute", top:8, right:8, background:"rgba(0,0,0,0.6)", border:"none", color:"#fff", borderRadius:20, padding:"4px 10px", cursor:"pointer", fontSize:12 }}>× 关闭</button>
                </div>
              )}
              {settlementMatchStatus && settlementMatchStatus.differences.length > 0 && (
                <div style={{ ...card, padding:"12px 16px", marginTop:16, background:`${C.red}08`, border:`1px solid ${C.red}40` }}>
                  <div style={{ fontSize:13, fontWeight:600, color:C.red, marginBottom:8 }}>PDF 核对差异：</div>
                  {settlementMatchStatus.differences.map((diff, i) => (
                    <div key={i} style={{ fontSize:12, color:C.muted, marginBottom:4 }}>• {diff}</div>
                  ))}
                </div>
              )}
            </div>
            <div style={card}>
              <div style={secHead}>AUD</div>
              <div style={{...grid("1fr 1fr 1fr 1fr"), marginBottom:22}}>
                {[["Equity","equity_aud"],["Cut 15%","cut_aud"],["Net 85%","net_aud"],["Transaction Fees","exe_aud"]].map(([l,k])=>(
                  <div key={k as string}><label style={lbl}>{l}</label>
                    <input type="number" step="0.01" style={inp} value={sForm[k as string]} onChange={e=>setSForm((p:any)=>({...p,[k as string]:e.target.value}))} /></div>
                ))}
              </div>
              <div style={secHead}>HKD</div>
              <div style={{...grid("1fr 1fr 1fr 1fr"), marginBottom:22}}>
                {[["Equity","equity_hkd"],["Cut 15%","cut_hkd"],["Net 85%","net_hkd"],["Transaction Fees","exe_hkd"]].map(([l,k])=>(
                  <div key={k as string}><label style={lbl}>{l}</label>
                    <input type="number" step="0.01" style={inp} value={sForm[k as string]} onChange={e=>setSForm((p:any)=>({...p,[k as string]:e.target.value}))} /></div>
                ))}
              </div>
              <div style={secHead}>Adjustments Sub Total（调整合计）</div>
              <div style={{...grid("1fr 1fr 1fr"), marginBottom:22}}>
                {[["AUD","adjustment_sub_total_aud"],["HKD","adjustment_sub_total_hkd"],["USD","adjustment_sub_total_usd"]].map(([l,k])=>(
                  <div key={k as string}><label style={lbl}>{l}</label>
                    <input type="number" step="0.01" style={inp} value={sForm[k as string]} onChange={e=>setSForm((p:any)=>({...p,[k as string]:e.target.value}))} /></div>
                ))}
              </div>
              <div style={secHead}>汇总</div>
              <div style={{marginBottom:8}}>
                <label style={{...lbl,marginBottom:6}}>Post Exchange Total（PDF 原始三栏，只读）</label>
                <div style={{...grid("1fr 1fr 1fr"),gap:8}}>
                  {[["AUD","post_exchange_aud"],["HKD","post_exchange_hkd"],["USD","post_exchange_usd"]].map(([ccy,k])=>(
                    <div key={k as string}>
                      <label style={{...lbl,fontSize:11}}>{ccy}</label>
                      <input type="number" step="0.01" style={{...inp,background:"#0a1828",cursor:"default"}} readOnly value={sForm[k as string]} onChange={e=>setSForm((p:any)=>({...p,[k as string]:e.target.value}))} />
                    </div>
                  ))}
                </div>
              </div>
              <div style={grid("1fr 1fr")}>
                <div><label style={lbl}>Wire Fees (USD)</label>
                  <input type="number" step="0.01" style={inp} value={sForm.wire_fees_usd} onChange={e=>setSForm((p:any)=>({...p,wire_fees_usd:e.target.value}))} /></div>
                <div><label style={lbl}>FX 备注</label><input type="text" style={inp} value={sForm.fx_notes} onChange={e=>setSForm((p:any)=>({...p,fx_notes:e.target.value}))} /></div>
              </div>
            </div>
            {/* Loss Coverage */}
            <div style={card}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                <div style={secHead}>Loss Coverage 亏损兑换</div>
                <button onClick={()=>setSForm((p:any)=>({...p,loss_coverage:[...p.loss_coverage,{from_ccy:"AUD",from_amount:"",to_ccy:"USD",to_amount:"",rate:""}]}))} style={ghostBtn()}>+ 添加</button>
              </div>
              {sForm.loss_coverage.length===0&&<div style={{fontSize:13,color:C.faint}}>本月无</div>}
              {sForm.loss_coverage.map((row:any,i:number)=>{
                // Loss Coverage 汇率 = 从 ÷ 到（覆盖币 ÷ 被覆盖币，取绝对值），与 PDF rate 列一致
                const syncLcRate = (a:any[], idx:number) => {
                  const f = Math.abs(parseFloat(a[idx].from_amount));
                  const t = Math.abs(parseFloat(a[idx].to_amount));
                  if (f > 0 && t > 0) a[idx].rate = (f / t).toFixed(6);
                };
                return (
                <div key={i} style={{...grid("80px 1fr 24px 80px 1fr 1fr 30px"),alignItems:"end",marginBottom:10}}>
                  {[
                    {l:"从",el:<select style={inp} value={row.from_ccy} onChange={e=>{const a=[...sForm.loss_coverage];a[i]={...a[i],from_ccy:e.target.value};setSForm((p:any)=>({...p,loss_coverage:a}))}}><option>AUD</option><option>HKD</option><option>USD</option></select>},
                    {l:"金额",el:<input type="number" style={inp} value={row.from_amount} onChange={e=>{const a=[...sForm.loss_coverage];a[i]={...a[i],from_amount:e.target.value};syncLcRate(a,i);setSForm((p:any)=>({...p,loss_coverage:a}))}} />},
                    {l:"",el:<div style={{textAlign:"center",paddingBottom:10,color:C.muted}}>→</div>},
                    {l:"到",el:<select style={inp} value={row.to_ccy} onChange={e=>{const a=[...sForm.loss_coverage];a[i]={...a[i],to_ccy:e.target.value};setSForm((p:any)=>({...p,loss_coverage:a}))}}><option>USD</option><option>HKD</option><option>AUD</option></select>},
                    {l:"金额",el:<input type="number" style={inp} value={row.to_amount} onChange={e=>{const a=[...sForm.loss_coverage];a[i]={...a[i],to_amount:e.target.value};syncLcRate(a,i);setSForm((p:any)=>({...p,loss_coverage:a}))}} />},
                    {l:"汇率（自动）",el:<input type="number" step="0.000001" style={{...inp,borderColor:C.blue+"60"}} value={row.rate} onChange={e=>{const a=[...sForm.loss_coverage];a[i]={...a[i],rate:e.target.value};setSForm((p:any)=>({...p,loss_coverage:a}))}} />},
                    {l:"",el:<button onClick={()=>{const a=sForm.loss_coverage.filter((_:any,j:number)=>j!==i);setSForm((p:any)=>({...p,loss_coverage:a}))}} style={{...ghostBtn(),padding:"8px"}}>×</button>},
                  ].map(({l,el},j)=><div key={j}>{l&&<label style={lbl}>{l}</label>}{el}</div>)}
                </div>
                );
              })}
            </div>
            {/* Payment Exchange */}
            <div style={card}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                <div>
                  <div style={secHead}>Payment Exchange 盈利兑换 USD</div>
                  <div style={{fontSize:12,color:C.blue,marginTop:-8,marginBottom:12}}>⚡ 汇率自动同步到结算参数</div>
                </div>
                <button onClick={()=>setSForm((p:any)=>({...p,payment_exchange:[...p.payment_exchange,{from_ccy:"AUD",from_amount:"",to_ccy:"USD",to_amount:"",rate:""}]}))} style={ghostBtn()}>+ 添加</button>
              </div>
              {sForm.payment_exchange.length===0&&<div style={{fontSize:13,color:C.faint}}>本月无</div>}
              {sForm.payment_exchange.map((row:any,i:number)=>{
                const syncRate = (a: any[], idx: number) => {
                  const from = parseFloat(a[idx].from_amount);
                  const to   = parseFloat(a[idx].to_amount);
                  if (from > 0 && to > 0) {
                    a[idx].rate = (to / from).toFixed(8);
                    if (a[idx].from_ccy==="AUD"&&a[idx].to_ccy==="USD") setFForm((f:any)=>({...f,fx_aud_usd:a[idx].rate}));
                    if (a[idx].from_ccy==="HKD"&&a[idx].to_ccy==="USD") setFForm((f:any)=>({...f,fx_hkd_usd:a[idx].rate}));
                  }
                };
                return (
                <div key={i} style={{...grid("80px 1fr 24px 80px 1fr 1fr 30px"),alignItems:"end",marginBottom:10}}>
                  {[
                    {l:"从",el:<select style={inp} value={row.from_ccy} onChange={e=>{const a=[...sForm.payment_exchange];a[i]={...a[i],from_ccy:e.target.value};setSForm((p:any)=>({...p,payment_exchange:a}))}}><option>AUD</option><option>HKD</option><option>USD</option></select>},
                    {l:"金额",el:<input type="number" style={inp} value={row.from_amount} onChange={e=>{const a=[...sForm.payment_exchange];a[i]={...a[i],from_amount:e.target.value};syncRate(a,i);setSForm((p:any)=>({...p,payment_exchange:a}))}} />},
                    {l:"",el:<div style={{textAlign:"center",paddingBottom:10,color:C.muted}}>→</div>},
                    {l:"到",el:<select style={inp} value={row.to_ccy} onChange={e=>{const a=[...sForm.payment_exchange];a[i]={...a[i],to_ccy:e.target.value};setSForm((p:any)=>({...p,payment_exchange:a}))}}><option>USD</option><option>HKD</option><option>AUD</option></select>},
                    {l:"金额",el:<input type="number" style={inp} value={row.to_amount} onChange={e=>{const a=[...sForm.payment_exchange];a[i]={...a[i],to_amount:e.target.value};syncRate(a,i);setSForm((p:any)=>({...p,payment_exchange:a}))}} />},
                    {l:"汇率（自动）",el:<input type="number" step="0.000001" style={{...inp,borderColor:C.blue+"60"}} value={row.rate} onChange={e=>{const a=[...sForm.payment_exchange];a[i]={...a[i],rate:e.target.value};setSForm((p:any)=>({...p,payment_exchange:a}));if(row.from_ccy==="AUD"&&row.to_ccy==="USD")setFForm((f:any)=>({...f,fx_aud_usd:e.target.value}));if(row.from_ccy==="HKD"&&row.to_ccy==="USD")setFForm((f:any)=>({...f,fx_hkd_usd:e.target.value}))}} />},
                    {l:"",el:<button onClick={()=>{const a=sForm.payment_exchange.filter((_:any,j:number)=>j!==i);setSForm((p:any)=>({...p,payment_exchange:a}))}} style={{...ghostBtn(),padding:"8px"}}>×</button>},
                  ].map(({l,el},j)=><div key={j}>{l&&<label style={lbl}>{l}</label>}{el}</div>)}
                </div>
                );
              })}
            </div>
            {/* ERP */}
            <div style={card}>
              <div style={secHead}>ERP Deposits / Withdrawals</div>
              <div style={grid("1fr 1fr")}>
                {[{label:"存入 Deposits", color:C.green, key:"erp_deposits"},{label:"提取 Withdrawals", color:C.red, key:"erp_withdrawals"}].map(({label,color,key})=>(
                  <div key={key}>
                    <div style={{fontSize:13,color,fontWeight:600,marginBottom:10}}>{label}</div>
                    {(sForm[key]as any[]).length===0&&<div style={{fontSize:13,color:C.faint,marginBottom:8}}>本月无</div>}
                    {(sForm[key]as any[]).map((row:any,i:number)=>(
                      <div key={i} style={{...grid("70px 1fr 100px 28px"),alignItems:"end",marginBottom:8}}>
                        {[
                          {l:"币种",el:<select style={inp} value={row.ccy} onChange={e=>{const a=[...(sForm[key]as any[])];a[i]={...a[i],ccy:e.target.value};setSForm((p:any)=>({...p,[key]:a}))}}><option>USD</option><option>AUD</option><option>HKD</option></select>},
                          {l:"金额",el:<input type="number" style={inp} value={row.amount} onChange={e=>{const a=[...(sForm[key]as any[])];a[i]={...a[i],amount:e.target.value};setSForm((p:any)=>({...p,[key]:a}))}} />},
                          {l:"日期",el:<input type="text" style={inp} placeholder="MM/DD/YYYY" value={row.date} onChange={e=>{const a=[...(sForm[key]as any[])];a[i]={...a[i],date:e.target.value};setSForm((p:any)=>({...p,[key]:a}))}} />},
                          {l:"",el:<button onClick={()=>{const a=(sForm[key]as any[]).filter((_:any,j:number)=>j!==i);setSForm((p:any)=>({...p,[key]:a}))}} style={{...ghostBtn(),padding:"6px"}}>×</button>},
                        ].map(({l,el},j)=><div key={j}>{l&&<label style={lbl}>{l}</label>}{el}</div>)}
                      </div>
                    ))}
                    <button onClick={()=>setSForm((p:any)=>({...p,[key]:[...(p[key]as any[]),{ccy:"USD",amount:"",date:""}]}))} style={{...ghostBtn(),fontSize:12,padding:"4px 10px"}}>+ 添加</button>
                  </div>
                ))}
              </div>
            </div>
            <div style={{display:"flex",gap:12}}>
              <button onClick={saveSettlement} style={filledBtn()} disabled={loading}>保存</button>
              <button onClick={()=>setSettlView("list")} style={ghostBtn()}>取消</button>
            </div>
          </div>
        )}

        {/* ══ PAYOUTS ══ */}
        {tab === "payouts" && (
          <div>
            {/* Summary cards */}
            <div style={{...grid("1fr 1fr 1fr"),marginBottom:20}}>
              {Object.entries(TRADERS).map(([id,cfg])=>{
                const rows=payouts.filter(p=>p.trader_id===id);
                const totalCny=rows.reduce((s,r)=>s+parseFloat(r.cny_amount||0),0);
                const totalUsd=rows.reduce((s,r)=>s+parseFloat(r.settle_usd||0),0);
                const bal=balances.find(b=>b.trader_id===id);
                const avail=(bal?parseFloat(bal.balance_usd):0)-cfg.reserve;
                return (
                  <div key={id} style={card}>
                    <div style={{fontSize:13,color:C.muted,marginBottom:6}}>{cfg.name} · {id}</div>
                    <div style={{fontSize:26,fontWeight:800,color:C.green}}>¥{Math.round(totalCny).toLocaleString()}</div>
                    <div style={{fontSize:12,color:C.faint,marginTop:4}}>累计发放 · {rows.length} 笔</div>
                    <div style={{marginTop:10,fontSize:13,display:"flex",gap:16}}>
                      <span style={{color:C.muted}}>累计 ${f2(totalUsd)} USD</span>
                      <span>可提取 <strong style={{color:avail>=0?C.green:C.red}}>${f2(Math.max(0,avail))}</strong></span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 2/3 + 1/3 parallel layout */}
            <div style={{display:"flex",gap:16,alignItems:"flex-start"}}>

              {/* ── Left 2/3: payout form + records ── */}
              <div style={{flex:"2 1 0",minWidth:0}}>
                {/* Row-based payout form */}
                <div style={card}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
                    <div style={{fontSize:17,fontWeight:700}}>录入提成发放</div>
                    <div style={{display:"flex",alignItems:"center",gap:12}}>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <label style={{...lbl,margin:0}}>发放日期</label>
                        <input type="date" style={{...inp,width:"auto",padding:"8px 12px"}} value={payoutDate} onChange={e=>setPayoutDate(e.target.value)} />
                      </div>
                    </div>
                  </div>

                  {/* Column headers */}
                  <div style={{display:"grid",gridTemplateColumns:"120px 100px 90px 100px 1fr 110px 28px",gap:10,marginBottom:6,padding:"0 2px"}}>
                    {["交易员","可结算 USD","汇率","CNY到账","业绩范围","结算账号",""].map(h=><div key={h} style={{fontSize:11,color:C.faint,fontWeight:700,letterSpacing:0.8}}>{h}</div>)}
                  </div>

                  {/* Rows */}
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    {payoutRows.map((row:any,idx:number)=>{
                      const bal=balances.find((b:any)=>b.trader_id===row.trader_id);
                      const balUsd=bal?parseFloat(bal.balance_usd):0;
                      const reserve=row._reserve??TRADERS[row.trader_id]?.reserve??0;
                      const settleUsd=Math.max(0,balUsd-reserve);
                      const fx=parseFloat(row.fx_cny)||0;
                      const cnyAmt=fx?Math.round(settleUsd*fx):0;
                      return (
                        <div key={idx} style={{display:"grid",gridTemplateColumns:"120px 100px 90px 100px 1fr 110px 28px",gap:10,alignItems:"center",background:C.elevated,borderRadius:8,padding:"10px 12px"}}>
                          <select style={{...inp,padding:"8px 10px",fontSize:13}} value={row.trader_id}
                            onChange={e=>updatePayoutRow(idx,"trader_id",e.target.value)}>
                            {Object.entries(TRADERS).map(([id,t])=><option key={id} value={id}>{t.name}</option>)}
                          </select>
                          <div style={{background:C.bg,borderRadius:6,padding:"8px 10px",fontSize:13,fontWeight:700,color:settleUsd>0?C.blue:C.faint,border:`1px solid ${C.border}`}}>
                            ${f2(settleUsd)}
                          </div>
                          <input type="number" step="0.0001" style={{...inp,padding:"8px 10px",fontSize:13}} placeholder="汇率"
                            value={row.fx_cny} onChange={e=>updatePayoutRow(idx,"fx_cny",e.target.value)} />
                          <div style={{background:C.bg,borderRadius:6,padding:"8px 10px",fontSize:13,fontWeight:700,color:cnyAmt>0?C.green:C.faint,border:`1px solid ${C.border}`,textAlign:"right"}}>
                            {cnyAmt>0?`¥${Math.round(cnyAmt).toLocaleString()}`:"—"}
                          </div>
                          <input type="text" style={{...inp,padding:"8px 10px",fontSize:13}} placeholder="如 2026-01,2026-02"
                            value={row.period_covered} onChange={e=>updatePayoutRow(idx,"period_covered",e.target.value)} />
                          <input type="text" style={{...inp,padding:"8px 10px",fontSize:13}} placeholder="结算账号"
                            value={row.bank_account} onChange={e=>updatePayoutRow(idx,"bank_account",e.target.value)} />
                          <button onClick={()=>removePayoutRow(idx)} style={{background:"transparent",border:`1px solid ${C.border}`,color:C.faint,cursor:"pointer",borderRadius:6,fontSize:13,width:28,height:28,display:"flex",alignItems:"center",justifyContent:"center"}} disabled={payoutRows.length===1}>×</button>
                        </div>
                      );
                    })}
                  </div>

                  {/* Add row + submit */}
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:14}}>
                    <button onClick={addPayoutRow} style={{...ghostBtn(),display:"flex",alignItems:"center",gap:6,padding:"8px 18px"}}>
                      <span style={{fontSize:18,lineHeight:1}}>+</span> 添加交易员
                    </button>
                    <div style={{display:"flex",alignItems:"center",gap:12}}>
                      {payoutRows.some((r:any)=>r.fx_cny) && (
                        <div style={{fontSize:13,color:C.muted}}>
                          {(() => {
                            const totals = payoutRows.reduce((acc:any,row:any)=>{
                              const bal=balances.find((b:any)=>b.trader_id===row.trader_id);
                              const balUsd=bal?parseFloat(bal.balance_usd):0;
                              const reserve=row._reserve??TRADERS[row.trader_id]?.reserve??0;
                              const settleUsd=Math.max(0,balUsd-reserve);
                              const fx=parseFloat(row.fx_cny)||0;
                              return { cny: acc.cny+(fx?settleUsd*fx:0), usd: acc.usd+settleUsd };
                            },{cny:0,usd:0});
                            return <>
                              合计{" "}
                              <strong style={{color:C.green}}>¥{Math.round(totals.cny).toLocaleString()}</strong>
                              <span style={{color:C.faint,margin:"0 6px"}}>/</span>
                              <strong style={{color:C.blue}}>${f2(totals.usd)} USD</strong>
                            </>;
                          })()}
                        </div>
                      )}
                      <button onClick={submitAllPayoutRows} style={filledBtn(C.green)} disabled={loading}>确认全部发放</button>
                    </div>
                  </div>
                </div>

                {/* Payout records */}
                <div style={{...card,padding:0,overflow:"hidden"}}>
                  <div style={{padding:"16px 24px",fontSize:15,fontWeight:600,borderBottom:`1px solid ${C.border}`}}>发放记录</div>
                  <div style={{display:"grid",gridTemplateColumns:"100px 70px 100px 90px 100px 65px 110px 1fr 28px",padding:"9px 16px",gap:8,fontSize:11,fontWeight:700,color:C.faint,letterSpacing:0.8,background:C.elevated,borderBottom:`1px solid ${C.border}`}}>
                    {["日期","交易员","余额USD","留存","结算USD","汇率","CNY到账","业绩范围",""].map(h=><div key={h}>{h}</div>)}
                  </div>
                  {payouts.length===0&&<div style={{padding:"28px",fontSize:14,color:C.faint,textAlign:"center"}}>暂无记录</div>}
                  {payouts.slice(payoutPage*PAYOUT_PAGE_SIZE,(payoutPage+1)*PAYOUT_PAGE_SIZE).map((p:any,i:number)=>(
                    <div key={p.id} style={{display:"grid",gridTemplateColumns:"100px 70px 100px 90px 100px 65px 110px 1fr 28px",padding:"11px 16px",gap:8,borderBottom:`1px solid ${C.border}`,background:i%2?`${C.elevated}60`:"transparent",alignItems:"center",fontSize:13}}>
                      <div style={{color:C.muted}}>{p.payout_date}</div>
                      <div style={{fontWeight:600}}>{TRADERS[p.trader_id]?.name}</div>
                      <div>${f2(p.balance_usd)}</div>
                      <div style={{color:C.red}}>-${f2(p.reserve_usd)}</div>
                      <div style={{fontWeight:700,color:C.blue}}>${f2(p.settle_usd)}</div>
                      <div style={{color:C.muted}}>{parseFloat(p.fx_cny).toFixed(4)}</div>
                      <div style={{fontWeight:700,color:C.green}}>¥{Math.round(p.cny_amount).toLocaleString()}</div>
                      <div style={{color:C.muted,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.period_covered||p.bank_account||"—"}</div>
                      <button onClick={()=>deletePayout(p)} style={{background:"transparent",border:`1px solid ${C.border}`,color:C.faint,cursor:"pointer",borderRadius:6,fontSize:13,width:26,height:26,display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
                    </div>
                  ))}
                  {payouts.length > PAYOUT_PAGE_SIZE && (
                    <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:10,padding:"10px 0",borderTop:`1px solid ${C.border}`}}>
                      <button onClick={()=>setPayoutPage(p=>Math.max(0,p-1))} disabled={payoutPage===0} style={ghostBtn()}>← 上页</button>
                      <span style={{fontSize:13,color:C.muted}}>第 {payoutPage+1} / {Math.ceil(payouts.length/PAYOUT_PAGE_SIZE)} 页</span>
                      <button onClick={()=>setPayoutPage(p=>Math.min(Math.ceil(payouts.length/PAYOUT_PAGE_SIZE)-1,p+1))} disabled={(payoutPage+1)*PAYOUT_PAGE_SIZE>=payouts.length} style={ghostBtn()}>下页 →</button>
                    </div>
                  )}
                  {payouts.length>0&&(
                    <div style={{display:"flex",justifyContent:"flex-end",gap:32,padding:"12px 16px",borderTop:`1px solid ${C.border}`,fontSize:13,color:C.muted}}>
                      <span>累计结算：<strong style={{color:C.blue}}>${f2(payouts.reduce((s,p)=>s+parseFloat(p.settle_usd||0),0))} USD</strong></span>
                      <span>累计发放：<strong style={{color:C.green}}>¥{Math.round(payouts.reduce((s,p)=>s+parseFloat(p.cny_amount||0),0)).toLocaleString()}</strong></span>
                    </div>
                  )}
                </div>
              </div>

              {/* ── Right 1/3: USD bank receipts ── */}
              <div style={{flex:"1 1 0",minWidth:0}}>
                <div style={card}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
                    <div style={{fontSize:15,fontWeight:700}}>美元到账记录</div>
                    {(sessionCnyTotal > 0 || sessionUsdTotal > 0) && (
                      <div style={{background:`${C.green}18`,border:`1px solid ${C.green}40`,borderRadius:6,padding:"4px 12px",fontSize:12,display:"flex",gap:10}}>
                        <span>本次 <strong style={{color:C.green}}>¥{Math.round(sessionCnyTotal).toLocaleString()}</strong></span>
                        <span style={{color:C.faint}}>|</span>
                        <span><strong style={{color:C.blue}}>${f2(sessionUsdTotal)}</strong> USD</span>
                      </div>
                    )}
                  </div>

                  {/* Rate calculator */}
                  <div style={{background:C.elevated,borderRadius:8,padding:"12px 14px",marginBottom:14,border:`1px solid ${C.border}`}}>
                    <div style={{fontSize:11,color:C.muted,marginBottom:8,fontWeight:600}}>汇率自动计算</div>
                    <div style={{fontSize:12,color:C.muted,marginBottom:6}}>
                      待结算：<strong style={{color:C.blue}}>${f2(usdReceipts.filter((r:any)=>!r.is_settled).reduce((s:number,r:any)=>s+parseFloat(r.amount_usd||0),0))}</strong>
                    </div>
                    <div style={{display:"flex",gap:8,marginBottom:8}}>
                      <input type="number" step="0.01" placeholder="本次合计人民币" style={{...inp,flex:1,padding:"8px 10px",fontSize:13}} value={cnyBatchInput} onChange={e=>setCnyBatchInput(e.target.value)} />
                      <button onClick={applyAutoRate} style={{...filledBtn(C.blue),padding:"8px 14px",fontSize:13,whiteSpace:"nowrap"}} disabled={loading}>同步汇率</button>
                    </div>
                    <div style={{fontSize:11,color:C.faint}}>输入合计CNY → 自动填入汇率框</div>
                  </div>

                  {/* Add receipt */}
                  <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:14}}>
                    <div style={{display:"flex",gap:8}}>
                      <input type="date" style={{...inp,flex:"0 0 auto",width:130,padding:"8px 10px",fontSize:13}} value={usdRForm.receipt_date} onChange={e=>setUsdRForm((f:any)=>({...f,receipt_date:e.target.value}))} />
                      <input type="number" step="0.01" placeholder="USD金额" style={{...inp,flex:1,padding:"8px 10px",fontSize:13}} value={usdRForm.amount_usd} onChange={e=>setUsdRForm((f:any)=>({...f,amount_usd:e.target.value}))} />
                    </div>
                    <div style={{display:"flex",gap:8}}>
                      <input type="text" placeholder="备注（交易员或说明）" style={{...inp,flex:1,padding:"8px 10px",fontSize:13}} value={usdRForm.note} onChange={e=>setUsdRForm((f:any)=>({...f,note:e.target.value}))} />
                      <button onClick={saveUsdReceipt} style={{...filledBtn(),padding:"8px 16px",fontSize:13,whiteSpace:"nowrap"}} disabled={loading}>+ 添加</button>
                    </div>
                  </div>

                  {/* Receipts list */}
                  {usdReceipts.length === 0 ? (
                    <div style={{textAlign:"center",padding:"16px",color:C.faint,fontSize:13}}>暂无记录</div>
                  ) : (
                    <div style={{border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden"}}>
                      {usdReceipts.map((r:any,i:number)=>(
                        <div key={r.id} style={{display:"grid",gridTemplateColumns:"1fr auto auto 26px",gap:8,padding:"10px 12px",borderBottom:i<usdReceipts.length-1?`1px solid ${C.border}`:"none",background:i%2?`${C.elevated}60`:"transparent",alignItems:"center",fontSize:13}}>
                          <div>
                            <div style={{fontWeight:700,color:C.blue}}>${f2(r.amount_usd)}</div>
                            <div style={{fontSize:11,color:C.faint,marginTop:2}}>{r.receipt_date} {r.note?`· ${r.note}`:""}</div>
                          </div>
                          <span style={tag(r.is_settled ? C.green : C.warn)}>{r.is_settled?"已结算":"待结算"}</span>
                          {!r.is_settled ? (
                            <button onClick={()=>markReceiptSettled(r.id)} style={{...ghostBtn(),fontSize:11,padding:"4px 8px",color:C.green,borderColor:C.green}} disabled={loading}>结算</button>
                          ) : <div />}
                          <button onClick={()=>deleteUsdReceipt(r.id)} style={{background:"transparent",border:`1px solid ${C.border}`,color:C.faint,cursor:"pointer",borderRadius:6,fontSize:13,width:26,height:26,display:"flex",alignItems:"center",justifyContent:"center"}} disabled={loading}>×</button>
                        </div>
                      ))}
                      <div style={{display:"flex",justifyContent:"space-between",padding:"8px 12px",background:C.elevated,fontSize:12,color:C.muted}}>
                        <span>待结算 <strong style={{color:C.warn}}>${f2(usdReceipts.filter((r:any)=>!r.is_settled).reduce((s:number,r:any)=>s+parseFloat(r.amount_usd||0),0))}</strong></span>
                        <span>已结算 <strong style={{color:C.green}}>${f2(usdReceipts.filter((r:any)=>r.is_settled).reduce((s:number,r:any)=>s+parseFloat(r.amount_usd||0),0))}</strong></span>
                        <span>合计 <strong style={{color:C.blue}}>${f2(usdReceipts.reduce((s:number,r:any)=>s+parseFloat(r.amount_usd||0),0))}</strong></span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

            </div>
          </div>
        )}

        {/* ══ DAILY PERFORMANCE ══ */}
        {tab === "daily" && (() => {
          // 当月数据（已由 loadDailyData 按月加载，dailyPerf 就是当月）

          // Current month string (e.g. "2026-06") for MTD calculations
          const curMonth = new Date().toISOString().slice(0, 7);
          // FX helper: use latest available confirmed rate, else rough fallback
          const sortedPf0 = [...periodFeesAll].sort((a: any, b: any) => b.period.localeCompare(a.period));
          const getFx = (ccy: string, month?: string): { rate: number; src: string } => {
            if (ccy === "AUD") {
              const pf = sortedPf0.find((p: any) => (!month || p.period <= month) && parseFloat(p.fx_aud_usd) > 0);
              return pf ? { rate: parseFloat(pf.fx_aud_usd), src: pf.period } : { rate: 0.63, src: "~估" };
            }
            if (ccy === "HKD") {
              const pf = sortedPf0.find((p: any) => (!month || p.period <= month) && parseFloat(p.fx_hkd_usd) > 0);
              return pf ? { rate: parseFloat(pf.fx_hkd_usd), src: pf.period } : { rate: 0.13, src: "~估" };
            }
            return { rate: 1, src: "" };
          };

          // Filtered detail rows（按交易员 + 日期范围筛选）
          const filtered = dailyPerf.filter(r =>
            (dailyFilter.trader === "All" || r.trader_name === dailyFilter.trader) &&
            r.trade_date >= dailyFilter.dateFrom &&
            r.trade_date <= dailyFilter.dateTo
          );
          const totalPages  = Math.ceil(filtered.length / DAILY_PAGE_SIZE);
          const pagedRows   = filtered.slice(dailyPage * DAILY_PAGE_SIZE, (dailyPage + 1) * DAILY_PAGE_SIZE);

          // Previous month string
          const prevMonthDate = new Date();
          prevMonthDate.setMonth(prevMonthDate.getMonth() - 1);
          const prevMonth = prevMonthDate.toISOString().slice(0, 7);

          // Helper: is a month confirmed in commission_results?
          const isConfirmed = (month: string) =>
            commissions.some((c: any) => c.period === month && c.status === "confirmed");

          // Helper: calc MTD for a trader + month from overviewPerf
          const calcMtd = (id: string, month: string, fx: number, ccy: string) => {
            const rows = overviewPerf.filter(r => r.trader_name === id && r.trade_date.startsWith(month));
            const net  = rows.reduce((s, r) => s + (parseFloat(r.trading_total) || 0), 0);
            const exe  = rows.reduce((s, r) => s + (parseFloat(r.exe_fee) || 0), 0);
            const days = new Set(rows.map(r => r.trade_date)).size;
            const usd  = net * fx;
            const pf   = sortedPf0.find((p: any) => p.period <= month && (ccy === "AUD" ? parseFloat(p.fx_aud_usd || 0) > 0 : parseFloat(p.fx_hkd_usd || 0) > 0));
            let rawEst: number;
            if (ccy === "AUD") {
              const asx   = pf ? parseFloat(pf.asx_aud ?? 264.44) / 2 : 132.22;
              const chixa = pf ? parseFloat(pf.chixa_usd ?? 129.0) / 2 : 64.50;
              rawEst = fx ? (net * 0.80 - exe - asx - chixa / fx) * fx - 75 : 0;
            } else {
              const hke = pf ? parseFloat(pf.hke_hkd ?? 451.70) : 451.70;
              rawEst = fx ? (net - exe - hke) * fx : 0;
            }
            const commEst = rawEst;
            return { net, days, usd, commEst };
          };

          // Build per-trader card data (fusing balance + recent perf)
          const traderCards = Object.entries(TRADERS).map(([id, cfg]) => {
            const b       = balances.find(x => x.trader_id === id);
            const bal     = b ? parseFloat(b.balance_usd) : 0;
            const reserve = cfg.reserve;
            const avail   = bal - reserve;
            const pct     = Math.min(100, Math.max(0, (bal / (reserve * 2)) * 100));
            const statusColor = !b || bal <= 0 ? C.red : bal < reserve / 2 ? C.red : bal < reserve ? C.warn : C.green;
            const statusLabel = !b || bal <= 0 ? "🚨 必须充值" : bal < reserve / 2 ? "⚠ 严重不足" : bal < reserve ? "⚠ 低于留存" : "✓ 正常";

            const { rate: curFx, src: curFxSrc } = getFx(cfg.ccy, curMonth);
            const { rate: prevFx } = getFx(cfg.ccy, prevMonth);
            const cur  = calcMtd(id, curMonth,  curFx, cfg.ccy);
            const prev = calcMtd(id, prevMonth, prevFx, cfg.ccy);
            // 预估月末余额 = 已确认余额 + 草稿提成 + 无结算记录月份估算
            const hasTradeRecordForMonth = (month: string) =>
              tradeRecords.some((r: any) => r.trader_id === id && r.period === month);
            const parseDraftMonthlyUsd = (c: any): number | null => {
              if (c.monthly_usd === null || c.monthly_usd === undefined || c.monthly_usd === "") return null;
              const value = parseFloat(c.monthly_usd);
              return Number.isFinite(value) ? value : null;
            };
            const isEffectiveCommission = (c: any) =>
              c.trader_id === id &&
              (c.status === "confirmed" ||
                (c.status === "draft" && parseDraftMonthlyUsd(c) !== null && hasTradeRecordForMonth(c.period)));
            const allDraftUsdId = commissions
              .filter((c: any) => c.trader_id === id && c.status === "draft" && isEffectiveCommission(c))
              .reduce((sum: number, c: any) => sum + (parseDraftMonthlyUsd(c) ?? 0), 0);
            const commPeriodsForId = new Set(commissions.filter(isEffectiveCommission).map((c: any) => c.period));
            const unconfEst = [curMonth, prevMonth]
              .filter(m => !commPeriodsForId.has(m) && (m === curMonth || m === prevMonth))
              .reduce((sum, m) => {
                const d = m === curMonth ? cur : prev;
                return sum + (d.days > 0 ? d.commEst : 0);
              }, 0);
            const projBal = bal + allDraftUsdId + unconfEst;

            return { id, cfg, bal, reserve, avail, pct, statusColor, statusLabel, cur, prev, projBal, fx: curFx, fxSrc: curFxSrc };
          });

          return (
            <div>
              {/* ── Integrated trader cards ── */}
              <div style={{ ...grid("1fr 1fr 1fr"), marginBottom: 20 }}>
                {traderCards.map(({ id, cfg, bal, reserve, avail, pct, statusColor, statusLabel, cur, prev, projBal, fxSrc }) => (
                  <div key={id} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, overflow: "hidden" }}>
                    {/* ── Header (same as Overview) ── */}
                    <div style={{ padding: "12px 18px 10px", borderBottom: `1px solid ${C.border}` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div>
                          <div style={{ fontSize: 18, fontWeight: 800 }}>{cfg.name}</div>
                          <div style={{ fontSize: 13, color: C.muted, marginTop: 1 }}>{id} · {cfg.ccy}</div>
                        </div>
                        <span style={{ fontSize: 12, padding: "2px 7px", borderRadius: 4, background: `${statusColor}18`, color: statusColor, fontWeight: 600 }}>{statusLabel}</span>
                      </div>
                    </div>

                    {/* ── Margin balance (same as Overview) ── */}
                    <div style={{ padding: "10px 18px 10px", borderBottom: `1px solid ${C.border}` }}>
                      <div style={{ fontSize: 13, color: C.muted, marginBottom: 2 }}>账户总余额</div>
                      <div style={{ fontSize: 24, fontWeight: 800, color: statusColor, lineHeight: 1.1 }}>${f2(bal)}</div>
                      <div style={{ fontSize: 12, color: C.faint, marginBottom: 8 }}>USD</div>
                      {/* Progress bar */}
                      <div style={{ height: 5, background: C.elevated, borderRadius: 3, marginBottom: 10, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${pct}%`, background: statusColor, borderRadius: 3, transition: "width 0.4s" }} />
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 13 }}>
                        <div style={{ background: C.elevated, borderRadius: 6, padding: "6px 8px" }}>
                          <div style={{ color: C.faint, marginBottom: 2 }}>留存要求</div>
                          <div style={{ color: C.muted, fontWeight: 600 }}>${f2(reserve)}</div>
                        </div>
                        <div style={{ background: C.elevated, borderRadius: 6, padding: "6px 8px" }}>
                          <div style={{ color: C.faint, marginBottom: 2 }}>可提取</div>
                          <div style={{ color: avail >= 0 ? C.green : C.red, fontWeight: 600 }}>${f2(Math.max(0, avail))}</div>
                        </div>
                      </div>
                    </div>

                    {/* ── 待确认业绩（本月 + 上月 并排）── */}
                    {(cur.days > 0 || prev.days > 0) && (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", borderTop: `1px solid ${C.border}` }}>
                        {[
                          { label: "本月", month: curMonth,  d: cur,  extra: true },
                          { label: "上月", month: prevMonth, d: prev, extra: false },
                        ].map(({ label, month, d, extra }, ci) => {
                          if (d.days === 0) return <div key={month} />;
                          const isDataConfirmed = dailyPerf.some(r => r.trader_name === id && r.trade_date.startsWith(month) && r.is_confirmed === true);
                          const confirmed = isConfirmed(month) || isDataConfirmed;
                          const tagColor  = confirmed ? C.green : C.warn;
                          const tagLabel  = confirmed ? "已核对" : "待确认";
                          const rows = [
                            { l: "Trading Total", v: `${d.net >= 0 ? "+" : ""}${d.net.toFixed(2)}`, c: d.net >= 0 ? C.green : C.red },
                            { l: "折 USD",        v: `${d.usd >= 0 ? "+" : ""}$${d.usd.toFixed(2)}`, c: d.usd >= 0 ? C.green : C.red },
                            { l: "提成估算",      v: d.commEst > 0 ? `+$${d.commEst.toFixed(2)}` : `未达线（-$${Math.abs(d.commEst).toFixed(2)}）`, c: d.commEst > 0 ? C.green : C.faint },
                            ...(extra ? [{ l: "预估月末余额", v: `$${projBal.toFixed(2)}`, c: projBal >= reserve ? C.green : C.warn }] : []),
                          ];
                          return (
                            <div key={month} style={{ padding: "10px 14px 12px", borderRight: ci === 0 ? `1px solid ${C.border}` : "none" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                                <div style={{ fontSize: 12, fontWeight: 700, color: C.muted }}>{label} · {d.days}日</div>
                                <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 10, fontWeight: 700, background: `${tagColor}22`, color: tagColor }}>{tagLabel}</span>
                              </div>
                              {rows.map(({ l, v, c }) => (
                                <div key={l} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "4px 0", borderBottom: `1px solid ${C.border}` }}>
                                  <span style={{ fontSize: 12, color: C.muted }}>{l}</span>
                                  <span style={{ fontSize: 15, fontWeight: 700, color: c }}>{v}</span>
                                </div>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <div style={{ padding: "4px 14px 7px", fontSize: 11, color: C.faint }}>* 提成粗算，汇率参考最近一次确认汇率</div>
                  </div>
                ))}
              </div>

              {/* ── Filter bar ── */}
              <div style={{ ...card, padding: "14px 20px", marginBottom: 16 }}>
                <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
                  <div>
                    <label style={lbl}>交易员</label>
                    <select style={{ ...inp, width: 190 }} value={dailyFilter.trader}
                      onChange={e => setDailyFilter(p => ({ ...p, trader: e.target.value }))}>
                      <option value="All">全部</option>
                      {Object.entries(TRADERS).map(([id, t]) => (
                        <option key={id} value={id}>{t.name} {id}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={lbl}>开始日期</label>
                    <input type="date" style={{ ...inp, width: 145 }} value={dailyFilter.dateFrom}
                      onChange={e => setDailyFilter(p => ({ ...p, dateFrom: e.target.value }))} />
                  </div>
                  <div>
                    <label style={lbl}>结束日期</label>
                    <input type="date" style={{ ...inp, width: 145 }} value={dailyFilter.dateTo}
                      onChange={e => setDailyFilter(p => ({ ...p, dateTo: e.target.value }))} />
                  </div>
                  <button style={ghostBtn()} onClick={() => {
                    const now = new Date();
                    const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
                    const to = now.toISOString().slice(0, 10);
                    setDailyFilter(p => ({ ...p, dateFrom: from, dateTo: to }));
                    loadDailyData(from, to);
                  }}>本月</button>
                  <button style={ghostBtn()} onClick={() => {
                    const now = new Date();
                    const y = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
                    const m = now.getMonth() === 0 ? 12 : now.getMonth();
                    const pad = (n: number) => String(n).padStart(2, "0");
                    const lastDay = new Date(y, m, 0).getDate();
                    const from = `${y}-${pad(m)}-01`;
                    const to = `${y}-${pad(m)}-${pad(lastDay)}`;
                    setDailyFilter(p => ({ ...p, dateFrom: from, dateTo: to }));
                    loadDailyData(from, to);
                  }}>上个月</button>
                  <button style={ghostBtn()} onClick={() => loadDailyData(dailyFilter.dateFrom, dailyFilter.dateTo)}>↻ 刷新</button>
                  <div style={{ width: 1, height: 22, background: C.border, margin: "0 4px" }} />
                  <input type="file" accept=".csv" ref={dailyUploadRef} onChange={handleDailyUpload} style={{ display: "none" }} />
                  <button style={ghostBtn()} onClick={() => dailyUploadRef.current?.click()} disabled={loading}>↑ 上传 CSV</button>
                  <button style={ghostBtn()} onClick={triggerDailyFetch} disabled={fetchingDaily}>
                    {fetchingDaily ? "抓取中…" : "↓ 抓取"}
                  </button>
                  <button style={ghostBtn()} onClick={handleMonthlyFetch} disabled={fetchingDaily}>
                    {fetchingDaily ? "抓取中…" : "📅 全月抓取"}
                  </button>
                  <button style={ghostBtn()} onClick={handleLockCurrentMonth} disabled={loading}>
                    🔒 数据锁定
                  </button>
                  <span style={{ fontSize: 14, color: C.faint, marginLeft: "auto" }}>
                    {filtered.length > 0 ? `共 ${filtered.length} 条` : dailyPerf.length === 0 ? "暂无数据，等待 20:00 自动抓取" : "无匹配"}
                  </span>
                </div>
              </div>

              {/* ── Detail table ── */}
              <div style={{ ...card, padding: 0, overflow: "hidden" }}>
                <div style={{ padding: "14px 24px", fontSize: 16, fontWeight: 600, borderBottom: `1px solid ${C.border}` }}>每日明细</div>
                <div style={{ display: "grid", gridTemplateColumns: "110px 90px 68px 72px 96px 96px 72px 72px 80px 106px 86px 88px", padding: "10px 24px", gap: 10, fontSize: 13, fontWeight: 700, color: C.faint, letterSpacing: 0.8, background: C.elevated, borderBottom: `1px solid ${C.border}` }}>
                  {["日期","交易员","状态","CCY","Gross","Gateway","Sec Fee","Act Fee","Exe Fee","Trading Total","股数","USD估"].map(h => <div key={h}>{h}</div>)}
                </div>
                {filtered.length === 0 && (
                  <div style={{ padding: "40px 24px", fontSize: 15, color: C.faint, textAlign: "center" }}>
                    {dailyPerf.length === 0 ? "暂无数据 — 每天 20:00 自动抓取，或手动运行 fetch_performance.py" : "该筛选条件下无数据"}
                  </div>
                )}
                {pagedRows.map((r, i) => {
                  const net  = parseFloat(r.trading_total) || 0;
                  const ccy  = r.currency ?? TRADERS[r.trader_name]?.ccy ?? "";
                  const rowTraderId = TRADERS[r.trader_name] ? r.trader_name : (Object.keys(TRADERS).find(id => TRADERS[id].name === r.trader_name) ?? r.trader_name);
                  const rowMonth = (r.trade_date || "").slice(0, 7);
                  const rowFx = getFx(ccy, rowMonth).rate;
                  const usdEst = net * rowFx;
                  const rowIsConf = (commissions.some((c:any) => c.trader_id === rowTraderId && c.period === rowMonth && c.status === "confirmed") || r.is_confirmed === true);
                  return (
                    <div key={r.id ?? i} style={{ display: "grid", gridTemplateColumns: "110px 90px 68px 72px 96px 96px 72px 72px 80px 106px 86px 88px", padding: "11px 24px", gap: 10, borderBottom: `1px solid ${C.border}`, background: i % 2 ? `${C.elevated}60` : "transparent", fontSize: 15, alignItems: "center" }}>
                      <div style={{ color: C.muted }}>
                        {r._source === "monthly_confirmed"
                          ? <><span style={{ color: C.blue, fontSize: 12, fontWeight: 700 }}>月度确认</span>{r._discrepancy && <span title={r._discrepancy} style={{ marginLeft: 4, color: C.warn, fontSize: 11 }}>⚠</span>}</>
                          : r._source === "trade_records"
                            ? <span style={{ color: C.green, fontSize: 12 }}>月汇总</span>
                            : r.trade_date}
                      </div>
                      <div style={{ fontWeight: 600 }}>{TRADERS[r.trader_name]?.name ?? r.trader_name}</div>
                      <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 8, fontWeight: 700, background: rowIsConf ? `${C.green}22` : `${C.warn}22`, color: rowIsConf ? C.green : C.warn }}>{rowIsConf ? "已核对" : "待确认"}</span>
                      <div style={{ color: C.faint }}>{ccy}</div>
                      <div style={{ color: (parseFloat(r.gross || 0)) >= 0 ? C.green : C.red }}>{parseFloat(r.gross || 0).toFixed(2)}</div>
                      <div style={{ color: C.red }}>{parseFloat(r.gateway_charge || 0) !== 0 ? `-${parseFloat(r.gateway_charge || 0).toFixed(4)}` : "0.0000"}</div>
                      <div style={{ color: C.faint }}>{parseFloat(r.sec_fee  || 0).toFixed(4)}</div>
                      <div style={{ color: C.faint }}>{parseFloat(r.act_fee  || 0).toFixed(4)}</div>
                      <div style={{ color: C.faint }}>{parseFloat(r.exe_fee  || 0).toFixed(4)}</div>
                      <div style={{ fontWeight: 700, color: net >= 0 ? C.green : C.red }}>
                        {net >= 0 ? "+" : ""}{net.toFixed(4)}
                      </div>
                      <div style={{ color: C.muted }}>{Math.round(parseFloat(r.shares || r.shares_traded || 0)).toLocaleString()}</div>
                      {/* A: 单日 USD 估算 */}
                      <div style={{ fontWeight: 600, color: usdEst >= 0 ? C.green : C.red, fontSize: 14 }}>
                        {usdEst >= 0 ? "+" : ""}${usdEst.toFixed(2)}
                      </div>
                    </div>
                  );
                })}
                {filtered.length > 0 && (() => {
                  const totNet   = filtered.reduce((s, r) => s + (parseFloat(r.trading_total)    || 0), 0);
                  const totGross = filtered.reduce((s, r) => s + (parseFloat(r.gross)            || 0), 0);
                  const totGw    = filtered.reduce((s, r) => s + (parseFloat(r.gateway_charge)   || 0), 0);
                  const totExe   = filtered.reduce((s, r) => s + (parseFloat(r.exe_fee)          || 0), 0);
                  const totUsd   = filtered.reduce((s, r) => {
                    const ccy = r.currency ?? TRADERS[r.trader_name]?.ccy ?? "";
                    const month = (r.trade_date || "").slice(0, 7);
                    return s + (parseFloat(r.trading_total) || 0) * getFx(ccy, month).rate;
                  }, 0);
                  return (
                    <div style={{ display: "grid", gridTemplateColumns: "110px 90px 68px 72px 96px 96px 72px 72px 80px 106px 86px 88px", padding: "10px 24px", gap: 10, borderTop: `1px solid ${C.border}`, fontSize: 13, fontWeight: 700, background: `${C.elevated}80`, alignItems: "center" }}>
                      <div style={{ color: C.faint }}>合计</div>
                      <div /><div /><div />
                      <div style={{ color: totGross >= 0 ? C.green : C.red }}>{totGross.toFixed(2)}</div>
                      <div style={{ color: C.red }}>-{totGw.toFixed(4)}</div>
                      <div /><div />
                      <div style={{ color: C.faint }}>{totExe.toFixed(4)}</div>
                      <div style={{ color: totNet >= 0 ? C.green : C.red }}>{totNet >= 0 ? "+" : ""}{totNet.toFixed(4)}</div>
                      <div />
                      <div style={{ color: totUsd >= 0 ? C.green : C.red }}>{totUsd >= 0 ? "+" : ""}${totUsd.toFixed(2)}</div>
                    </div>
                  );
                })()}
                {/* 分页 */}
                {totalPages > 1 && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "10px 0", borderTop: `1px solid ${C.border}` }}>
                    <button onClick={() => setDailyPage(p => Math.max(0, p - 1))} disabled={dailyPage === 0} style={ghostBtn()}>← 上页</button>
                    <span style={{ fontSize: 13, color: C.muted }}>第 {dailyPage + 1} / {totalPages} 页（共 {filtered.length} 条）</span>
                    <button onClick={() => setDailyPage(p => Math.min(totalPages - 1, p + 1))} disabled={dailyPage >= totalPages - 1} style={ghostBtn()}>下页 →</button>
                  </div>
                )}
              </div>
            </div>
          );
        })()}


        {/* ══ CONFIG ══ */}
        {tab === "config" && (
          <div style={card}>
            <div style={{fontSize:17,fontWeight:700,marginBottom:6}}>结算参数</div>
            <div style={{fontSize:14,color:C.muted,marginBottom:24}}>每月结算前填写。上传 Settlement 截图/PDF 后汇率自动同步，也可手填。</div>
            <div style={grid("1fr 1fr 1fr 1fr")}>
              {[["月份","period","text"],["ASX 数据费 (AUD)","asx_aud","number"],["CHIXA 数据费 (USD)","chixa_usd","number"],["HKE 数据费 (HKD)","hke_hkd","number"],["Office 费 (USD)","office_usd","number"],["Wire 费 (USD)","wire_usd","number"]].map(([label,key,type])=>{
                const isFxField = key==="fx_aud_usd"||key==="fx_hkd_usd";
                const src = key==="fx_aud_usd" ? fxSrc.aud : fxSrc.hkd;
                const fromPdf = src==="pdf"||src==="derived";
                const fromPrev = src==="prev";
                return (
                <div key={key as string}>
                  <label style={lbl}>
                    {label}
                    {isFxField && (
                      <span style={{marginLeft:6,fontSize:11,color: fromPdf ? C.blue : C.faint}}>
                        ⚡ {fromPdf ? (src==="derived" ? "Loss Coverage推算" : "PDF") : fromPrev ? "参考上期" : "手动/未同步"}
                      </span>
                    )}
                    {isFxField && fromPrev && (
                      <span style={{marginLeft:6,fontSize:11,fontWeight:700,color:C.warn}}>待定</span>
                    )}
                  </label>
                  <input
                    type={type as string} step="0.00000001" style={inp}
                    value={fForm[key as string]}
                    onChange={e=>{
                      setFForm((p:any)=>({...p,[key as string]:e.target.value}));
                      if(isFxField) setFxSrc(s=>({...s,[key==="fx_aud_usd"?"aud":"hkd"]:""}));
                    }}
                    placeholder={key==="period"?"2026-02":"留空可稍后补填"}
                  />
                </div>
              )})}
            </div>
            <button onClick={saveFees} style={{...filledBtn(),marginTop:24}} disabled={loading}>保存</button>
          </div>
        )}

        {/* ══ README ══ */}
        {tab === "readme" && (
          <div style={card}>
            <div style={{fontSize:17,fontWeight:700,marginBottom:20}}>系统文档 README</div>
            {readme
              ? <div>{renderReadme(readme)}</div>
              : <div style={{color:C.faint,fontSize:13,padding:"20px 0"}}>加载中…</div>}
          </div>
        )}

      </div>
      </div>
    </div>
  );
}
