import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

const TRADERS: Record<string, { name: string; ccy: string; reserve: number }> = {
  HONG045: { name: "王博", ccy: "AUD", reserve: 1000 },
  PENGCDU: { name: "马金斗", ccy: "AUD", reserve: 1000 },
  LULUSHI: { name: "石路路", ccy: "HKD", reserve: 500 },
};

const f2 = (n: number) => Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const C = { bg: "#08111E", surface: "#0E1A2B", elevated: "#152234", border: "#1C2E44", text: "#DCE8F5", muted: "#7A95B0", faint: "#3A5068", blue: "#4080FF", green: "#34C47C", red: "#F05050", warn: "#E8A530" };
const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
type MTab = "overview" | "performance" | "payouts" | "entry";

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

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

export default function MobileAdminDashboard({ onLogout }: { onLogout: () => void }) {
  const [tab, setTab] = useState<MTab>("overview");
  const [balances, setBalances] = useState<any[]>([]);
  const [tradeRecords, setTradeRecords] = useState<any[]>([]);
  const [commissions, setCommissions] = useState<any[]>([]);
  const [periodFeesAll, setPeriodFeesAll] = useState<any[]>([]);
  const [payouts, setPayouts] = useState<any[]>([]);
  const [dailyRecs, setDailyRecs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [selectedPerfPeriod, setSelectedPerfPeriod] = useState("");
  const [mForm, setMForm] = useState({ trader_id: "HONG045", type: "deposit", amount_usd: "", entry_date: todayStr(), note: "" });
  const [usdForm, setUsdForm] = useState({ receipt_date: todayStr(), amount_usd: "", note: "" });

  const now = new Date();
  const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const previousPeriod = `${new Date(now.getFullYear(), now.getMonth() - 1, 1).getFullYear()}-${String(new Date(now.getFullYear(), now.getMonth() - 1, 1).getMonth() + 1).padStart(2, "0")}`;

  const reload = () => {
    supabase.from("margin_balances").select("*").then(r => setBalances(r.data || []));
    supabase.from("trade_records").select("*").order("period", { ascending: false }).then(r => setTradeRecords(r.data || []));
    supabase.from("commission_results").select("*").order("period", { ascending: false }).then(r => setCommissions(r.data || []));
    supabase.from("period_fees").select("*").order("period", { ascending: false }).then(r => setPeriodFeesAll(r.data || []));
    supabase.from("commission_payouts").select("*").order("payout_date", { ascending: false }).then(r => setPayouts(r.data || []));
    supabase.from("daily_performance").select("trader_name, trade_date, trading_total, gross, gateway_charge, exe_fee").order("trade_date", { ascending: false }).then(r => setDailyRecs(r.data || []));
  };
  useEffect(() => { reload(); }, []);

  const showToast = (msg: string, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 2600); };
  const paidMap = useMemo(() => {
    const m = new Map<string, boolean>();
    payouts.forEach((p: any) => expandPeriodCovered(p.period_covered).forEach(period => m.set(`${p.trader_id}:${period}`, true)));
    return m;
  }, [payouts]);

  const nameToId = Object.fromEntries(Object.entries(TRADERS).map(([id, cfg]) => [cfg.name, id]));
  const dailyByTraderMonth = useMemo(() => {
    const m = new Map<string, { net: number; exe: number }>();
    dailyRecs.forEach((r: any) => {
      const month = String(r.trade_date || "").slice(0, 7);
      const tid = TRADERS[r.trader_name] ? r.trader_name : (nameToId[r.trader_name] ?? r.trader_name);
      if (!month || !tid) return;
      const net = parseFloat(r.trading_total || 0) || (parseFloat(r.gross || 0) - parseFloat(r.gateway_charge || 0));
      const exe = parseFloat(r.exe_fee || 0) || 0;
      const key = `${tid}:${month}`;
      const prev = m.get(key) || { net: 0, exe: 0 };
      m.set(key, { net: prev.net + net, exe: prev.exe + exe });
    });
    return m;
  }, [dailyRecs]);

  const parseDraftMonthlyUsd = (c: any): number | null => {
    if (c.monthly_usd === null || c.monthly_usd === undefined || c.monthly_usd === "") return null;
    const n = parseFloat(c.monthly_usd);
    return Number.isFinite(n) ? n : null;
  };
  const hasTradeRecordForMonth = (traderId: string, month: string) => tradeRecords.some((r: any) => r.trader_id === traderId && r.period === month);
  const isEffectiveCommission = (c: any) => c.status === "confirmed" || (c.status === "draft" && parseDraftMonthlyUsd(c) !== null && hasTradeRecordForMonth(c.trader_id, c.period));
  const hasCommissionResult = (traderId: string, month: string) => commissions.some((c: any) => c.trader_id === traderId && c.period === month && isEffectiveCommission(c));

  const getPeriodFee = (traderId: string, month: string) => {
    const isHkd = traderId === "LULUSHI";
    return [...periodFeesAll].sort((a, b) => b.period.localeCompare(a.period)).find((p: any) => p.period <= month && (isHkd ? parseFloat(p.fx_hkd_usd || 0) > 0 : parseFloat(p.fx_aud_usd || 0) > 0));
  };
  const estimateCommission = (traderId: string, month: string, net: number, exe: number): number | null => {
    const pf = getPeriodFee(traderId, month);
    const isHkd = traderId === "LULUSHI";
    const fx = pf ? parseFloat(isHkd ? pf.fx_hkd_usd : pf.fx_aud_usd) : 0;
    if (!fx) return null;
    if (isHkd) return (net - exe - parseFloat(pf.hke_hkd ?? 451.70)) * fx;
    return (net * 0.8 - exe - parseFloat(pf.asx_aud ?? 264.44) / 2 - parseFloat(pf.chixa_usd ?? 129) / 2 / fx) * fx - 75;
  };
  const getTradeEstimate = (r: any) => {
    const net = (parseFloat(r.gross || 0) - parseFloat(r.gateway_charge || 0));
    const val = estimateCommission(r.trader_id, r.period, net, parseFloat(r.exe_fee || 0));
    const pf = getPeriodFee(r.trader_id, r.period);
    return { val, ref: pf && pf.period !== r.period ? pf.period : "" };
  };

  const allDataPeriods = [...new Set([
    ...commissions.filter(isEffectiveCommission).map((c: any) => c.period),
    ...tradeRecords.map((r: any) => r.period),
    ...[...dailyByTraderMonth.keys()].map(k => k.split(":")[1]),
  ])].sort().reverse();
  const activePerfPeriod = selectedPerfPeriod && allDataPeriods.includes(selectedPerfPeriod) ? selectedPerfPeriod : (allDataPeriods[0] || currentPeriod);

  const addMargin = async () => {
    if (!mForm.amount_usd) return;
    setLoading(true);
    try {
      const amt = parseFloat(mForm.amount_usd) * (mForm.type === "deposit" ? 1 : -1);
      const { data: rows } = await supabase.from("margin_ledger").select("amount_usd").eq("trader_id", mForm.trader_id);
      const prevBal = (rows || []).reduce((s: number, e: any) => s + parseFloat(e.amount_usd), 0);
      const { error } = await supabase.from("margin_ledger").insert({ trader_id: mForm.trader_id, entry_date: mForm.entry_date, type: mForm.type, amount_usd: amt, balance_after: prevBal + amt, note: mForm.note, period: "" });
      if (error) throw error;
      showToast("保证金已录入"); setMForm(p => ({ ...p, amount_usd: "", note: "" })); reload();
    } catch (e: any) { showToast(e.message, false); }
    setLoading(false);
  };
  const addUsdReceipt = async () => {
    if (!usdForm.amount_usd) return;
    setLoading(true);
    try {
      const { error } = await supabase.from("usd_bank_receipts").insert({ receipt_date: usdForm.receipt_date, amount_usd: parseFloat(usdForm.amount_usd), note: usdForm.note, is_settled: false });
      if (error) throw error;
      showToast("美元到账已录入"); setUsdForm({ receipt_date: todayStr(), amount_usd: "", note: "" }); reload();
    } catch (e: any) { showToast(e.message, false); }
    setLoading(false);
  };

  const card: React.CSSProperties = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16, marginBottom: 12 };
  const inp: React.CSSProperties = { background: C.elevated, border: `1px solid ${C.border}`, borderRadius: 10, padding: "11px 13px", color: C.text, fontSize: 15, fontFamily: font, outline: "none", width: "100%", boxSizing: "border-box" };
  const lbl: React.CSSProperties = { fontSize: 12, color: C.muted, marginBottom: 6, display: "block", fontWeight: 500 };
  const btn = (bg = C.blue): React.CSSProperties => ({ width: "100%", padding: 13, borderRadius: 10, border: "none", background: loading ? `${bg}66` : bg, color: "#fff", fontSize: 15, fontFamily: font, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer" });

  return <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: font, paddingBottom: 76 }}>
    <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 10 }}>
      <div><div style={{ fontSize: 16, fontWeight: 800 }}>管理端</div><div style={{ fontSize: 11, color: C.faint }}>Mobile Admin</div></div>
      <button onClick={onLogout} style={{ background: "transparent", border: `1px solid ${C.border}`, borderRadius: 8, color: C.muted, padding: "6px 14px", fontSize: 13 }}>退出</button>
    </div>
    {toast && <div style={{ padding: "11px 18px", color: toast.ok ? C.green : C.red, background: `${toast.ok ? C.green : C.red}14` }}>{toast.msg}</div>}
    <div style={{ padding: 16 }}>
      {tab === "overview" && <div>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>交易员概要</div>
        {Object.entries(TRADERS).map(([id, cfg]) => {
          const bal = parseFloat(balances.find((x: any) => x.trader_id === id)?.balance_usd || 0);
          const allDraftUsd = commissions.filter((c: any) => c.trader_id === id && c.status === "draft" && isEffectiveCommission(c)).reduce((s, c) => s + (parseDraftMonthlyUsd(c) ?? 0), 0);
          let dailyEst = 0;
          [currentPeriod, previousPeriod].forEach(month => {
            if (hasCommissionResult(id, month)) return;
            const d = dailyByTraderMonth.get(`${id}:${month}`);
            if (!d) return;
            dailyEst += estimateCommission(id, month, d.net, d.exe) ?? 0;
          });
          const projBal = bal + allDraftUsd + dailyEst;
          const avail = bal - cfg.reserve;
          const statusColor = bal <= 0 ? C.red : bal < cfg.reserve ? C.warn : C.green;
          const statusLabel = bal <= 0 ? "必须充值" : bal < cfg.reserve ? "低于留存" : "正常";
          return <div key={id} style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}><div><div style={{ fontSize: 17, fontWeight: 800 }}>{cfg.name}</div><div style={{ fontSize: 12, color: C.muted }}>{id} · {cfg.ccy}</div></div><span style={{ fontSize: 12, padding: "3px 10px", borderRadius: 20, background: `${statusColor}22`, color: statusColor, fontWeight: 700 }}>{statusLabel}</span></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>{[["账户余额", `$${f2(bal)}`, bal >= 0 ? C.text : C.red], ["留存保证金", `$${f2(cfg.reserve)}`, C.muted], ["可发放", avail > 0 ? `$${f2(avail)}` : "-", avail > 0 ? C.green : C.faint], ["预估月末余额", `$${f2(projBal)}`, projBal < cfg.reserve ? C.warn : C.green]].map(([a, b, color]) => <div key={a as string} style={{ background: C.elevated, borderRadius: 10, padding: "10px 12px" }}><div style={{ fontSize: 11, color: C.faint, marginBottom: 4 }}>{a}</div><div style={{ fontSize: 14, fontWeight: 700, color: color as string }}>{b}</div></div>)}</div>
          </div>;
        })}
      </div>}

      {tab === "performance" && <div>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>交易业绩</div>
        {allDataPeriods.length > 0 && <select style={{ ...inp, marginBottom: 10 }} value={activePerfPeriod} onChange={e => setSelectedPerfPeriod(e.target.value)}>{allDataPeriods.map(p => <option key={p} value={p}>{p}</option>)}</select>}
        {Object.keys(TRADERS).map(id => {
          const cfg = TRADERS[id];
          const tr = tradeRecords.find((r: any) => r.trader_id === id && r.period === activePerfPeriod);
          const cr = commissions.find((c: any) => c.trader_id === id && c.period === activePerfPeriod && isEffectiveCommission(c));
          const daily = dailyByTraderMonth.get(`${id}:${activePerfPeriod}`);
          if (!tr && !cr && !daily) return null;
          const isPaid = paidMap.has(`${id}:${activePerfPeriod}`);
          const isConfirmed = cr?.status === "confirmed";
          const isDraft = cr?.status === "draft";
          const statusLabel = isPaid ? "已发放" : isConfirmed ? "已核对" : isDraft ? "待核对" : "预估";
          const statusColor = isPaid ? C.green : isConfirmed ? C.green : isDraft ? C.warn : C.blue;
          const net = tr ? parseFloat(tr.gross || 0) - parseFloat(tr.gateway_charge || 0) : cr ? parseFloat(cr.net_native || 0) : daily?.net ?? 0;
          const est = cr ? { val: parseFloat(cr.monthly_usd || 0), ref: "" } : tr ? getTradeEstimate(tr) : daily ? { val: estimateCommission(id, activePerfPeriod, daily.net, daily.exe), ref: "" } : { val: null, ref: "" };
          return <div key={id} style={card}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}><div><span style={{ fontSize: 16, fontWeight: 800 }}>{cfg.name}</span><span style={{ fontSize: 12, color: C.muted, marginLeft: 8 }}>{cfg.ccy}</span></div><span style={{ fontSize: 12, padding: "3px 10px", borderRadius: 20, background: `${statusColor}22`, color: statusColor, fontWeight: 700 }}>{statusLabel}</span></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}><div style={{ background: C.elevated, borderRadius: 10, padding: "10px 12px" }}><div style={{ fontSize: 11, color: C.faint, marginBottom: 4 }}>NET</div><div style={{ color: net >= 0 ? C.green : C.red, fontWeight: 700 }}>{net >= 0 ? "+" : "-"}{f2(net)} {cfg.ccy}</div></div><div style={{ background: C.elevated, borderRadius: 10, padding: "10px 12px" }}><div style={{ fontSize: 11, color: C.faint, marginBottom: 4 }}>业绩提成</div><div style={{ color: est.val == null ? C.faint : est.val >= 0 ? C.green : C.red, fontWeight: 700 }}>{est.val == null ? "待录汇率" : `${est.val >= 0 ? "+" : "-"}$${f2(est.val)}`}</div>{est.ref && <div style={{ fontSize: 10, color: C.faint }}>参考 {est.ref}</div>}</div></div>
          </div>;
        })}
      </div>}

      {tab === "payouts" && <div><div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>提成发放记录</div>{payouts.map((p: any, i) => <div key={i} style={card}><div style={{ display: "flex", justifyContent: "space-between" }}><div><div style={{ fontWeight: 700 }}>{TRADERS[p.trader_id]?.name || p.trader_id}</div><div style={{ fontSize: 12, color: C.muted }}>{p.payout_date}</div></div><div style={{ color: C.green, fontWeight: 800 }}>${f2(parseFloat(p.settle_usd || 0))}</div></div></div>)}</div>}

      {tab === "entry" && <div>
        <div style={card}><div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>手工录入保证金</div><div style={{ display: "grid", gap: 10 }}><select style={inp} value={mForm.trader_id} onChange={e => setMForm(p => ({ ...p, trader_id: e.target.value }))}>{Object.entries(TRADERS).map(([id, t]) => <option key={id} value={id}>{t.name}</option>)}</select><select style={inp} value={mForm.type} onChange={e => setMForm(p => ({ ...p, type: e.target.value }))}><option value="deposit">存入</option><option value="withdraw">提取/离职</option></select><input type="number" style={inp} placeholder="金额 USD" value={mForm.amount_usd} onChange={e => setMForm(p => ({ ...p, amount_usd: e.target.value }))} /><input type="date" style={inp} value={mForm.entry_date} onChange={e => setMForm(p => ({ ...p, entry_date: e.target.value }))} /><input type="text" style={inp} placeholder="备注" value={mForm.note} onChange={e => setMForm(p => ({ ...p, note: e.target.value }))} /><button onClick={addMargin} disabled={loading} style={btn()}>录入保证金</button></div></div>
        <div style={card}><div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>美元到账登记</div><div style={{ display: "grid", gap: 10 }}><input type="date" style={inp} value={usdForm.receipt_date} onChange={e => setUsdForm(p => ({ ...p, receipt_date: e.target.value }))} /><input type="number" style={inp} placeholder="金额 USD" value={usdForm.amount_usd} onChange={e => setUsdForm(p => ({ ...p, amount_usd: e.target.value }))} /><input type="text" style={inp} placeholder="备注" value={usdForm.note} onChange={e => setUsdForm(p => ({ ...p, note: e.target.value }))} /><button onClick={addUsdReceipt} disabled={loading} style={btn(C.green)}>登记到账</button></div></div>
      </div>}
    </div>
    <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: C.surface, borderTop: `1px solid ${C.border}`, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", padding: "6px 0" }}>{[["overview", "概要"], ["performance", "业绩"], ["payouts", "发放"], ["entry", "录入"]].map(([k, label]) => <button key={k} onClick={() => setTab(k as MTab)} style={{ background: "transparent", border: "none", color: tab === k ? C.blue : C.muted, fontSize: 12, padding: "8px 4px", fontFamily: font, fontWeight: tab === k ? 700 : 500 }}>{label}</button>)}</div>
  </div>;
}
