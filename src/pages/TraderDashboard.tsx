import { useEffect, useMemo, useRef, useState } from "react";
import { supabase, db, signOut } from "../lib/supabase";

const TRADER_META: Record<string, { name: string; ccy: string; color: string; exchange: string; reserve: number }> = {
  HONG045: { name: "王博", ccy: "AUD", color: "#00C8FF", exchange: "ASX · CHIXA", reserve: 1000 },
  PENGCDU: { name: "马金斗", ccy: "AUD", color: "#00EF7A", exchange: "ASX · CHIXA", reserve: 1000 },
  LULUSHI: { name: "石路路", ccy: "HKD", color: "#FFB300", exchange: "HKEx", reserve: 500 },
};
const f2 = (n: number) => Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function expandPeriodCovered(pc: any): string[] {
  if (!pc) return [];
  const parts = Array.isArray(pc) ? pc.map(String) : String(pc).split(",").map(s => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const part of parts) {
    const m = part.match(/^(\d{4})[.\-](\d{2})[- ](\d{4})[.\-](\d{2})$/);
    if (!m) { out.push(part.replace(/\./g, "-")); continue; }
    let y = Number(m[1]), mo = Number(m[2]);
    const ey = Number(m[3]), em = Number(m[4]);
    while (y < ey || (y === ey && mo <= em)) {
      out.push(`${y}-${String(mo).padStart(2, "0")}`);
      mo++; if (mo > 12) { mo = 1; y++; }
    }
  }
  return out;
}

export default function TraderDashboard({ traderId, onLogout }: { traderId: string; onLogout: () => void }) {
  const [tab, setTab] = useState<"home" | "monthly" | "margin">("home");
  const [performance, setPerf] = useState<any[]>([]);
  const [payouts, setPayouts] = useState<any[]>([]);
  const [balance, setBalance] = useState<any>(null);
  const [ledger, setLedger] = useState<any[]>([]);
  const [tradeRecs, setTradeRecs] = useState<any[]>([]);
  const [dailyRecs, setDailyRecs] = useState<any[]>([]);
  const [periodFeesAll, setPeriodFeesAll] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(new Date());
  const [expandedPeriod, setExpandedPeriod] = useState<string | null>(null);
  const pullStartY = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const meta = TRADER_META[traderId] || { name: traderId, ccy: "-", color: "#00C8FF", exchange: "-", reserve: 1000 };
  const C = { bg: "#060A12", card: "#0D1829", border: "#182840", dim: "#4A6882", text: "#C4DAF0", green: "#00EF7A", red: "#FF2847", warn: "#FFB300", blue: "#4080FF" };
  const now = new Date();
  const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const previousPeriod = `${new Date(now.getFullYear(), now.getMonth() - 1, 1).getFullYear()}-${String(new Date(now.getFullYear(), now.getMonth() - 1, 1).getMonth() + 1).padStart(2, "0")}`;

  const loadData = async () => {
    await Promise.all([
      supabase.from("commission_results").select("*").eq("trader_id", traderId).order("period", { ascending: false }).then(r => setPerf(r.data || [])),
      supabase.from("commission_payouts").select("*").eq("trader_id", traderId).order("payout_date", { ascending: false }).then(r => setPayouts(r.data || [])),
      db.getBalances().then(r => setBalance((r.data || []).find((x: any) => x.trader_id === traderId) || null)),
      db.getLedger(traderId).then(r => setLedger(r.data || [])),
      supabase.from("trade_records").select("*").eq("trader_id", traderId).order("period", { ascending: false }).then(r => setTradeRecs(r.data || [])),
      supabase.from("daily_performance").select("trade_date, trading_total, gross, gateway_charge, exe_fee").eq("trader_name", traderId).order("trade_date", { ascending: false }).then(r => setDailyRecs(r.data || [])),
      supabase.from("period_fees").select("*").order("period", { ascending: false }).then(r => setPeriodFeesAll(r.data || [])),
    ]);
    setLastUpdate(new Date());
  };
  useEffect(() => { loadData(); }, [traderId]);

  const parseDraftMonthlyUsd = (c: any): number | null => {
    if (c.monthly_usd === null || c.monthly_usd === undefined || c.monthly_usd === "") return null;
    const n = parseFloat(c.monthly_usd);
    return Number.isFinite(n) ? n : null;
  };
  const hasTradeRecordForMonth = (month: string) => tradeRecs.some((r: any) => r.period === month);
  const isEffectiveCommission = (c: any) => c.status === "confirmed" || (c.status === "draft" && parseDraftMonthlyUsd(c) !== null && hasTradeRecordForMonth(c.period));

  const dailyByMonth = useMemo(() => {
    const m = new Map<string, { net: number; exe: number }>();
    dailyRecs.forEach((r: any) => {
      const month = String(r.trade_date || "").slice(0, 7);
      if (!month) return;
      const net = parseFloat(r.trading_total || 0) || (parseFloat(r.gross || 0) - parseFloat(r.gateway_charge || 0));
      const exe = parseFloat(r.exe_fee || 0) || 0;
      const prev = m.get(month) || { net: 0, exe: 0 };
      m.set(month, { net: prev.net + net, exe: prev.exe + exe });
    });
    return m;
  }, [dailyRecs]);

  const getPeriodFee = (period: string) => {
    const isAud = meta.ccy === "AUD";
    return [...periodFeesAll].sort((a, b) => b.period.localeCompare(a.period)).find((p: any) => p.period <= period && (isAud ? parseFloat(p.fx_aud_usd || 0) > 0 : parseFloat(p.fx_hkd_usd || 0) > 0));
  };
  const getFallbackFx = (period: string) => {
    const row = performance
      .filter((c: any) => c.status === "confirmed" && c.period <= period && parseFloat(c.fx_rate || 0) > 0)
      .sort((a: any, b: any) => b.period.localeCompare(a.period))[0];
    return row ? parseFloat(row.fx_rate) : 0;
  };
  const getEstCommUsd = (netNative: number, exeNative: number, period: string): number | null => {
    const isAud = meta.ccy === "AUD";
    const pf = getPeriodFee(period);
    const fx = pf ? parseFloat(isAud ? pf.fx_aud_usd : pf.fx_hkd_usd) : getFallbackFx(period);
    if (!fx) return null;
    if (isAud) return (netNative * 0.8 - exeNative - parseFloat(pf?.asx_aud ?? 264.44) / 2 - parseFloat(pf?.chixa_usd ?? 129) / 2 / fx) * fx - 75;
    return (netNative - exeNative - parseFloat(pf?.hke_hkd ?? 451.70)) * fx;
  };

  const baseBalance = parseFloat(balance?.balance_usd || 0);
  const confirmedPerfMap = new Map(performance.filter((c: any) => c.status === "confirmed").map((c: any) => [c.period, c]));
  const perfMap = new Map(performance.filter(isEffectiveCommission).map((c: any) => [c.period, c]));
  const tradeMap = new Map(tradeRecs.map((r: any) => [r.period, r]));
  const confirmedPeriods = new Set(performance.filter((c: any) => c.status === "confirmed").map((c: any) => c.period));
  let pendingRiskEst = 0;
  [currentPeriod, previousPeriod].forEach(month => {
    if (confirmedPeriods.has(month)) return;
    const d = dailyByMonth.get(month);
    if (d) {
      pendingRiskEst += getEstCommUsd(d.net, d.exe, month) ?? 0;
      return;
    }
    const tr = tradeMap.get(month);
    if (tr) {
      const net = parseFloat(tr.net_native || 0) || (parseFloat(tr.gross || 0) - parseFloat(tr.gateway_charge || 0));
      pendingRiskEst += getEstCommUsd(net, parseFloat(tr.exe_fee || 0), month) ?? 0;
    }
  });
  const projBal = baseBalance + pendingRiskEst;
  const projColor = projBal <= 0 ? C.red : projBal <= meta.reserve ? C.warn : C.green;
  const paidPeriods = new Set(payouts.flatMap((p: any) => expandPeriodCovered(p.period_covered)));
  const latestConfirmed = performance.find((c: any) => c.status === "confirmed") || performance[0];
  const totalPayCny = payouts.reduce((s, p) => s + parseFloat(p.cny_amount || 0), 0);

  const allKnownPeriods = [currentPeriod, previousPeriod, ...performance.map((c: any) => c.period), ...tradeRecs.map((r: any) => r.period), ...[...dailyByMonth.keys()]];
  const startPeriod = allKnownPeriods.reduce((min, p) => p < min ? p : min, currentPeriod);
  const monthRange = (from: string, to: string) => {
    const out: string[] = [];
    let [y, m] = from.split("-").map(Number);
    const [ey, em] = to.split("-").map(Number);
    while (y < ey || (y === ey && m <= em)) { out.push(`${y}-${String(m).padStart(2, "0")}`); m++; if (m > 12) { m = 1; y++; } }
    return out;
  };
  const displayMonths = monthRange(startPeriod, currentPeriod).reverse().map(period => {
    if (confirmedPerfMap.has(period)) return { ...confirmedPerfMap.get(period), _source: "commission" };
    const daily = dailyByMonth.get(period);
    if (daily) return { period, status: "estimate", monthly_usd: 0, net_native: daily.net, settle_native: daily.net, exe_fee: daily.exe, _source: "daily" };
    const tr = tradeMap.get(period);
    if (tr) {
      const net = parseFloat(tr.net_native || 0) || (parseFloat(tr.gross || 0) - parseFloat(tr.gateway_charge || 0));
      return { period, status: "estimate", monthly_usd: 0, net_native: net, settle_native: net, exe_fee: parseFloat(tr.exe_fee || 0), _source: "trade" };
    }
    return { period, status: "pending", monthly_usd: 0, settle_native: 0, _placeholder: true };
  });

  const refresh = async () => { setRefreshing(true); await loadData(); setRefreshing(false); };
  const handleTouchStart = (e: React.TouchEvent) => { pullStartY.current = e.touches[0].clientY; };
  const handleTouchEnd = async (e: React.TouchEvent) => { if (e.changedTouches[0].clientY - pullStartY.current > 70 && (containerRef.current?.scrollTop || 0) <= 0 && !refreshing) await refresh(); };
  const typeLabel: Record<string, string> = { deposit: "存入", deduct: "扣减", withdraw: "提取", commission: "提成结算" };

  return <div style={{ position: "fixed", inset: 0, background: C.bg, color: C.text, fontFamily: "system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif", display: "flex", flexDirection: "column" }}>
    <div style={{ background: "#0A1422", borderBottom: `1px solid ${C.border}`, padding: "14px 20px 12px", flexShrink: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><div style={{ display: "flex", gap: 12, alignItems: "center" }}><div style={{ width: 42, height: 42, borderRadius: "50%", background: `${meta.color}22`, border: `2px solid ${meta.color}55`, display: "flex", alignItems: "center", justifyContent: "center", color: meta.color, fontWeight: 900 }}>{meta.name[0]}</div><div><div style={{ fontSize: 18, fontWeight: 800, color: meta.color }}>{meta.name}</div><div style={{ fontSize: 11, color: C.dim }}>{traderId} · {meta.exchange}</div></div></div><button onClick={() => { signOut(); onLogout(); }} style={{ background: "transparent", border: `1px solid ${C.border}`, color: C.dim, padding: "6px 16px", borderRadius: 20 }}>退出</button></div>
    </div>
    <div ref={containerRef} onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd} style={{ flex: 1, overflowY: "auto", padding: "16px 14px 20px" }}>
      {refreshing && <div style={{ textAlign: "center", color: C.dim, fontSize: 12 }}>刷新中...</div>}
      {tab === "home" && <>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderTop: `3px solid ${projColor}`, borderRadius: 18, padding: "24px 20px 20px", marginBottom: 12 }}><div style={{ fontSize: 12, color: C.dim, marginBottom: 10 }}>预估月末余额</div><div style={{ fontSize: 48, fontWeight: 900, color: projColor, lineHeight: 1 }}>${f2(projBal)}</div><div style={{ fontSize: 13, color: C.dim, marginTop: 8 }}>USD · 更新于 {lastUpdate.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</div></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}><div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: "18px 14px" }}><div style={{ fontSize: 12, color: C.dim, marginBottom: 8 }}>本月业绩</div>{(() => { const c = confirmedPerfMap.get(currentPeriod); const d = dailyByMonth.get(currentPeriod); const tr = tradeMap.get(currentPeriod); const net = tr ? (parseFloat(tr.gross || 0) - parseFloat(tr.gateway_charge || 0)) : d?.net ?? 0; const est = c ? parseFloat(c.monthly_usd || 0) : d ? getEstCommUsd(d.net, d.exe, currentPeriod) : tr ? getEstCommUsd(net, parseFloat(tr.exe_fee || 0), currentPeriod) : null; return est !== null ? <><div style={{ fontSize: 26, fontWeight: 900, color: est >= 0 ? C.green : C.red }}>{est >= 0 ? "+" : "-"}${f2(est)}</div><div style={{ fontSize: 11, color: C.dim, marginTop: 6 }}>{currentPeriod} · {c ? "已核对" : "预估"}</div></> : <><div style={{ fontSize: 22, color: C.dim }}>-</div><div style={{ fontSize: 11, color: C.dim }}>暂无数据</div></>; })()}</div><div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: "18px 14px" }}><div style={{ fontSize: 12, color: C.dim, marginBottom: 8 }}>累计已发放</div><div style={{ fontSize: 26, fontWeight: 900, color: C.green }}>¥{Math.round(totalPayCny).toLocaleString()}</div><div style={{ fontSize: 11, color: C.dim, marginTop: 6 }}>CNY · {payouts.length} 笔</div></div></div>
      </>}
      {tab === "monthly" && <>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: "18px 16px", marginBottom: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}><div><div style={{ fontSize: 12, color: C.dim, marginBottom: 6 }}>最新已核对</div><div style={{ fontSize: 22, fontWeight: 900, color: parseFloat(latestConfirmed?.monthly_usd || 0) >= 0 ? C.green : C.red }}>{parseFloat(latestConfirmed?.monthly_usd || 0) >= 0 ? "+" : "-"}${f2(parseFloat(latestConfirmed?.monthly_usd || 0))}</div><div style={{ fontSize: 11, color: C.dim }}>{latestConfirmed?.period || "暂无"} · USD</div></div><div><div style={{ fontSize: 12, color: C.dim, marginBottom: 6 }}>累计已发放</div><div style={{ fontSize: 22, fontWeight: 900, color: C.green }}>¥{Math.round(totalPayCny).toLocaleString()}</div><div style={{ fontSize: 11, color: C.dim }}>CNY · {payouts.length} 笔</div></div></div>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, overflow: "hidden" }}><div style={{ padding: "14px 16px 10px", fontSize: 13, color: C.dim, fontWeight: 600 }}>所有月份业绩</div>{displayMonths.map((c: any, i) => { const isPlaceholder = !!c._placeholder; const isEstimate = c._source === "daily" || c._source === "trade"; const isPaid = paidPeriods.has(c.period); const isConfirmed = c.status === "confirmed"; const statusLabel = isPaid ? "已发放" : isConfirmed ? "已核对" : isEstimate ? "预估" : "待核对"; const statusColor = isPaid ? C.green : isConfirmed ? C.blue : isEstimate ? C.blue : C.warn; const net = parseFloat(c.net_native || c.settle_native || 0); const exe = parseFloat(c.exe_fee || 0); const est = isEstimate ? getEstCommUsd(net, exe, c.period) : parseFloat(c.monthly_usd || 0); const expanded = expandedPeriod === c.period; return <div key={c.period} style={{ borderTop: `1px solid ${C.border}`, background: i % 2 ? "#ffffff04" : "transparent", opacity: isPlaceholder ? 0.5 : 1 }}><div onClick={() => !isPlaceholder && setExpandedPeriod(expanded ? null : c.period)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", cursor: isPlaceholder ? "default" : "pointer" }}><div><div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}><span style={{ fontSize: 15, fontWeight: 700 }}>{c.period}</span><span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 10, background: `${statusColor}22`, color: statusColor, fontWeight: 600 }}>{statusLabel}</span></div><div style={{ fontSize: 12, color: C.dim }}>{isPlaceholder ? "暂无数据" : `NET ${net >= 0 ? "+" : "-"}${f2(net)} ${meta.ccy}`}</div></div><div style={{ textAlign: "right" }}>{isPlaceholder ? <div style={{ color: C.dim }}>-</div> : est !== null ? <><div style={{ fontSize: 20, fontWeight: 900, color: isEstimate ? (est >= 0 ? C.green : C.red) : !isConfirmed ? C.dim : est >= 0 ? C.green : C.red }}>{isEstimate ? "~" : ""}{est >= 0 ? "+" : "-"}${f2(est)}</div><div style={{ fontSize: 11, color: C.dim }}>USD</div></> : <div style={{ color: C.dim }}>待录汇率</div>}</div></div>{expanded && !isPlaceholder && <div style={{ padding: "10px 16px 16px", background: "#ffffff06", borderTop: `1px solid ${C.border}`, display: "grid", gap: 6 }}><div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}><span style={{ color: C.dim }}>NET</span><span style={{ color: net >= 0 ? C.green : C.red }}>{net >= 0 ? "+" : "-"}{f2(net)} {meta.ccy}</span></div><div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}><span style={{ color: C.dim }}>Exe Fee</span><span>{f2(exe)} {meta.ccy}</span></div>{est !== null && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}><span style={{ color: C.dim }}>业绩提成</span><span style={{ color: est >= 0 ? C.green : C.red }}>{est >= 0 ? "+" : "-"}${f2(est)}</span></div>}</div>}</div>; })}</div>
      </>}
      {tab === "margin" && <>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderTop: `3px solid ${baseBalance <= 0 ? C.red : baseBalance <= meta.reserve ? C.warn : C.green}`, borderRadius: 18, padding: "22px 20px", marginBottom: 14 }}><div style={{ fontSize: 12, color: C.dim, marginBottom: 8 }}>账户余额</div><div style={{ fontSize: 44, fontWeight: 900, color: baseBalance <= 0 ? C.red : baseBalance <= meta.reserve ? C.warn : C.green }}>${f2(baseBalance)}</div><div style={{ fontSize: 13, color: C.dim }}>USD</div></div>
        <div style={{ fontSize: 13, color: C.dim, marginBottom: 10 }}>流水记录</div>{ledger.map((e: any) => { const amt = parseFloat(e.amount_usd || 0); const isPos = amt >= 0; return <div key={e.id || `${e.entry_date}-${e.note}`} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "14px 16px", marginBottom: 10 }}><div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}><div><div style={{ fontSize: 13, color: C.dim }}>{e.entry_date}</div><div style={{ fontSize: 15, fontWeight: 700 }}>{typeLabel[e.type] || e.type}</div></div><div style={{ textAlign: "right" }}><div style={{ fontSize: 18, fontWeight: 900, color: isPos ? C.green : C.red }}>{isPos ? "+" : "-"}${f2(amt)}</div>{e.balance_after !== null && e.balance_after !== undefined && <div style={{ fontSize: 12, color: C.dim }}>余额 ${f2(parseFloat(e.balance_after))}</div>}</div></div>{e.note && <div style={{ fontSize: 12, color: C.dim }}>{e.note}</div>}</div>; })}</>}
    </div>
    <div style={{ flexShrink: 0, background: "#0A1422", borderTop: `1px solid ${C.border}`, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", padding: "6px 0 max(6px, env(safe-area-inset-bottom))" }}>{[{ k: "home", label: "首页" }, { k: "monthly", label: "每月业绩" }, { k: "margin", label: "保证金" }].map(item => <button key={item.k} onClick={() => setTab(item.k as any)} style={{ background: "transparent", border: "none", color: tab === item.k ? meta.color : C.dim, padding: "8px 4px", fontSize: 12, fontWeight: tab === item.k ? 700 : 500 }}>{item.label}</button>)}</div>
  </div>;
}
