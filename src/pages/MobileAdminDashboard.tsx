import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

const TRADERS: Record<string, { name: string; ccy: string; reserve: number }> = {
  HONG045: { name: "王博",   ccy: "AUD", reserve: 1000 },
  PENGCDU: { name: "马金斗", ccy: "AUD", reserve: 1000 },
  LULUSHI: { name: "石路路", ccy: "HKD", reserve: 500  },
};

const f2 = (n: number) =>
  Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const C = {
  bg: "#08111E", surface: "#0E1A2B", elevated: "#152234", border: "#1C2E44",
  text: "#DCE8F5", muted: "#7A95B0", faint: "#3A5068",
  blue: "#4080FF", green: "#34C47C", red: "#F05050", warn: "#E8A530",
};
const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', sans-serif";

type MTab = "overview" | "performance" | "payouts" | "entry";

const today = () => new Date().toISOString().slice(0, 10);

export default function MobileAdminDashboard({ onLogout }: { onLogout: () => void }) {
  const [tab, setTab] = useState<MTab>("overview");
  const [balances, setBalances]         = useState<any[]>([]);
  const [tradeRecords, setTradeRecords] = useState<any[]>([]);
  const [commissions, setCommissions]   = useState<any[]>([]);
  const [periodFeesAll, setPeriodFeesAll] = useState<any[]>([]);
  const [payouts, setPayouts]           = useState<any[]>([]);
  const [period, setPeriod]             = useState(() => new Date().toISOString().slice(0, 7));
  const [loading, setLoading]           = useState(false);
  const [toast, setToast]               = useState<{ msg: string; ok: boolean } | null>(null);

  // 保证金录入表单
  const [mForm, setMForm] = useState({
    trader_id: "HONG045", type: "deposit",
    amount_usd: "", entry_date: today(), note: "",
  });

  // 美元到账表单
  const [usdForm, setUsdForm] = useState({
    receipt_date: today(), amount_usd: "", note: "",
  });

  const MONTHS = (() => {
    const list: string[] = [];
    const d = new Date("2025-11-01");
    const end = new Date(); end.setMonth(end.getMonth() + 3);
    while (d <= end) { list.push(d.toISOString().slice(0, 7)); d.setMonth(d.getMonth() + 1); }
    return list.reverse();
  })();

  const reload = () => {
    supabase.from("margin_balances").select("*").then(r => setBalances(r.data || []));
    supabase.from("trade_records").select("*").order("period", { ascending: false }).then(r => setTradeRecords(r.data || []));
    supabase.from("commission_results").select("*").order("period", { ascending: false }).then(r => setCommissions(r.data || []));
    supabase.from("period_fees").select("*").order("period", { ascending: false }).then(r => setPeriodFeesAll(r.data || []));
    supabase.from("commission_payouts").select("*").order("payout_date", { ascending: false }).then(r => setPayouts(r.data || []));
  };

  useEffect(() => { reload(); }, []);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  };

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
      showToast("保证金已录入");
      setMForm(p => ({ ...p, amount_usd: "", note: "" }));
      reload();
    } catch (e: any) { showToast(e.message, false); }
    setLoading(false);
  };

  const addUsdReceipt = async () => {
    if (!usdForm.amount_usd) return;
    setLoading(true);
    try {
      const { error } = await supabase.from("usd_bank_receipts").insert({
        receipt_date: usdForm.receipt_date,
        amount_usd: parseFloat(usdForm.amount_usd),
        note: usdForm.note,
        is_settled: false,
      });
      if (error) throw error;
      showToast("美元到账已录入");
      setUsdForm({ receipt_date: today(), amount_usd: "", note: "" });
      reload();
    } catch (e: any) { showToast(e.message, false); }
    setLoading(false);
  };

  const card: React.CSSProperties = {
    background: C.surface, border: `1px solid ${C.border}`,
    borderRadius: 14, padding: "16px", marginBottom: 12,
  };

  const inp: React.CSSProperties = {
    background: C.elevated, border: `1px solid ${C.border}`, borderRadius: 10,
    padding: "11px 13px", color: C.text, fontSize: 15, fontFamily: font,
    outline: "none", width: "100%", boxSizing: "border-box",
  };

  const lbl: React.CSSProperties = {
    fontSize: 12, color: C.muted, marginBottom: 6, display: "block", fontWeight: 500,
  };

  const btn = (bg = C.blue): React.CSSProperties => ({
    width: "100%", padding: "13px", borderRadius: 10, border: "none",
    background: loading ? `${bg}60` : bg, color: "#fff", fontSize: 15,
    fontFamily: font, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer",
  });

  const periodRecords = tradeRecords.filter((r: any) => r.period === period);

  const getEstComm = (r: any): { val: number | null; ref: string } => {
    const confirmedRec = commissions.find((c: any) =>
      c.trader_id === r.trader_id && c.period === r.period && c.status === "confirmed"
    );
    if (confirmedRec) return { val: parseFloat(confirmedRec.monthly_usd || 0), ref: "" };

    const net = (r.gross || 0) - (r.gateway_charge || 0);
    const sorted = [...periodFeesAll].sort((a: any, b: any) => b.period.localeCompare(a.period));
    const pf = sorted.find((p: any) =>
      p.period <= r.period &&
      (r.trader_id === "LULUSHI" ? parseFloat(p.fx_hkd_usd || 0) > 0 : parseFloat(p.fx_aud_usd || 0) > 0)
    );
    if (!pf) return { val: null, ref: "" };
    const ref = pf.period !== r.period ? pf.period : "";
    if (r.trader_id === "LULUSHI") {
      const fx = parseFloat(pf.fx_hkd_usd);
      const settleN = net - (r.exe_fee || 0) - parseFloat(pf.hke_hkd ?? 451.70);
      return { val: settleN * fx, ref };
    } else {
      const fx = parseFloat(pf.fx_aud_usd);
      const settleN = net * 0.80 - (r.exe_fee || 0)
        - parseFloat(pf.asx_aud ?? 264.44) / 2
        - parseFloat(pf.chixa_usd ?? 129.0) / 2 / fx;
      return { val: settleN * fx - 75, ref };
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: font, paddingBottom: 76 }}>

      {/* Header */}
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 10 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>31O-1232</div>
          <div style={{ fontSize: 11, color: C.faint }}>DTPPro8</div>
        </div>
        <button onClick={onLogout} style={{ background: "transparent", border: `1px solid ${C.border}`, borderRadius: 8, color: C.muted, padding: "6px 14px", fontSize: 13, fontFamily: font, cursor: "pointer" }}>退出</button>
      </div>

      {/* Toast */}
      {toast && (
        <div style={{ padding: "11px 18px", fontSize: 14, fontWeight: 500, color: toast.ok ? C.green : C.red, background: `${toast.ok ? C.green : C.red}14`, borderBottom: `1px solid ${toast.ok ? C.green : C.red}30` }}>
          {toast.ok ? "✓" : "✗"}&ensp;{toast.msg}
        </div>
      )}

      {/* Content */}
      <div style={{ padding: "16px" }}>

        {/* ── 概要 ── */}
        {tab === "overview" && (
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>交易员概要</div>
            {Object.entries(TRADERS).map(([id, cfg]) => {
              const b = balances.find((x: any) => x.trader_id === id);
              const bal = b ? parseFloat(b.balance_usd) : 0;
              const avail = bal - cfg.reserve;
              const statusColor = bal <= 0 ? C.red : bal < cfg.reserve / 2 ? C.red : bal < cfg.reserve ? C.warn : C.green;
              const statusLabel = bal <= 0 ? "🚨 必须充值" : bal < cfg.reserve / 2 ? "⚠ 严重不足" : bal < cfg.reserve ? "⚠ 低于留存" : "✓ 正常";
              return (
                <div key={id} style={card}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                    <div>
                      <div style={{ fontSize: 17, fontWeight: 800 }}>{cfg.name}</div>
                      <div style={{ fontSize: 12, color: C.muted }}>{id} · {cfg.ccy}</div>
                    </div>
                    <span style={{ fontSize: 12, padding: "3px 10px", borderRadius: 20, fontWeight: 700, background: `${statusColor}22`, color: statusColor }}>{statusLabel}</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                    {[
                      ["账户余额", `$${f2(bal)}`, bal >= 0 ? C.text : C.red],
                      ["留存保证金", `$${f2(cfg.reserve)}`, C.muted],
                      ["可发放", avail > 0 ? `$${f2(avail)}` : "—", avail > 0 ? C.green : C.faint],
                    ].map(([label, val, color]) => (
                      <div key={label as string} style={{ background: C.elevated, borderRadius: 10, padding: "10px 12px" }}>
                        <div style={{ fontSize: 11, color: C.faint, marginBottom: 4 }}>{label}</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: color as string }}>{val}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── 业绩 ── */}
        {tab === "performance" && (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>交易业绩</div>
              <select value={period} onChange={e => setPeriod(e.target.value)} style={{ background: C.elevated, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: "6px 10px", fontSize: 13, fontFamily: font, outline: "none" }}>
                {MONTHS.map(m => <option key={m}>{m}</option>)}
              </select>
            </div>
            {periodRecords.length === 0 && (
              <div style={{ textAlign: "center", color: C.faint, fontSize: 14, padding: "40px 0" }}>该月暂无上传数据</div>
            )}
            {periodRecords.map((r: any, i: number) => {
              const cfg = TRADERS[r.trader_id];
              const net = (r.gross || 0) - (r.gateway_charge || 0);
              const isConfirmed = commissions.some((c: any) => c.trader_id === r.trader_id && c.period === r.period && c.status === "confirmed");
              const stLbl = isConfirmed ? "已核对" : "待确认";
              const stClr = isConfirmed ? C.green : C.warn;
              const { val: estComm, ref: fxRef } = getEstComm(r);
              return (
                <div key={i} style={card}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <div>
                      <span style={{ fontSize: 16, fontWeight: 800 }}>{cfg?.name || r.trader_id}</span>
                      <span style={{ fontSize: 12, color: C.muted, marginLeft: 8 }}>{r.ccy}</span>
                    </div>
                    <span style={{ fontSize: 12, padding: "3px 10px", borderRadius: 20, fontWeight: 700, background: `${stClr}22`, color: stClr }}>{stLbl}</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {[
                      ["NET", `${net >= 0 ? "+" : ""}${f2(net)} ${r.ccy}`, net >= 0 ? C.green : C.red],
                      ["业绩提成",
                        estComm == null ? "待录汇率" : `${estComm >= 0 ? "+" : "-"}$${f2(Math.abs(estComm))}`,
                        estComm == null ? C.faint : estComm >= 0 ? C.green : C.red],
                    ].map(([label, val, color]) => (
                      <div key={label as string} style={{ background: C.elevated, borderRadius: 10, padding: "10px 12px" }}>
                        <div style={{ fontSize: 11, color: C.faint, marginBottom: 4 }}>{label}</div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: color as string }}>{val}</div>
                        {label === "业绩提成" && fxRef && <div style={{ fontSize: 10, color: C.faint, marginTop: 2 }}>参考{fxRef}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── 发放 ── */}
        {tab === "payouts" && (
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>提成发放记录</div>
            {payouts.length === 0 && <div style={{ textAlign: "center", color: C.faint, fontSize: 14, padding: "40px 0" }}>暂无发放记录</div>}
            {payouts.map((p: any, i: number) => {
              const cfg = TRADERS[p.trader_id];
              return (
                <div key={i} style={card}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 700 }}>{cfg?.name || p.trader_id}</div>
                      <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{p.payout_date}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 16, fontWeight: 800, color: C.green }}>${f2(p.settle_usd)}</div>
                      {p.cny_amount && <div style={{ fontSize: 12, color: C.muted }}>¥{Math.round(p.cny_amount).toLocaleString()}</div>}
                    </div>
                  </div>
                  {p.period_covered && <div style={{ fontSize: 11, color: C.faint, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>覆盖月份：{p.period_covered}</div>}
                </div>
              );
            })}
          </div>
        )}

        {/* ── 录入 ── */}
        {tab === "entry" && (
          <div>
            {/* 保证金录入 */}
            <div style={card}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>手工录入保证金</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <label style={lbl}>交易员</label>
                    <select style={inp} value={mForm.trader_id} onChange={e => setMForm(p => ({ ...p, trader_id: e.target.value }))}>
                      {Object.entries(TRADERS).map(([id, t]) => <option key={id} value={id}>{t.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={lbl}>类型</label>
                    <select style={inp} value={mForm.type} onChange={e => setMForm(p => ({ ...p, type: e.target.value }))}>
                      <option value="deposit">存入</option>
                      <option value="withdraw">提取/离职</option>
                    </select>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <label style={lbl}>金额 USD</label>
                    <input type="number" style={inp} placeholder="0.00" value={mForm.amount_usd}
                      onChange={e => setMForm(p => ({ ...p, amount_usd: e.target.value }))} />
                  </div>
                  <div>
                    <label style={lbl}>日期</label>
                    <input type="date" style={inp} value={mForm.entry_date}
                      onChange={e => setMForm(p => ({ ...p, entry_date: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <label style={lbl}>备注</label>
                  <input type="text" style={inp} placeholder="可选" value={mForm.note}
                    onChange={e => setMForm(p => ({ ...p, note: e.target.value }))} />
                </div>
                <button onClick={addMargin} style={btn(C.blue)} disabled={loading}>录入保证金</button>
              </div>
            </div>

            {/* 美元到账录入 */}
            <div style={card}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>美元到账录入</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <label style={lbl}>到账日期</label>
                    <input type="date" style={inp} value={usdForm.receipt_date}
                      onChange={e => setUsdForm(p => ({ ...p, receipt_date: e.target.value }))} />
                  </div>
                  <div>
                    <label style={lbl}>金额 USD</label>
                    <input type="number" style={inp} placeholder="0.00" value={usdForm.amount_usd}
                      onChange={e => setUsdForm(p => ({ ...p, amount_usd: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <label style={lbl}>备注</label>
                  <input type="text" style={inp} placeholder="来源说明（可选）" value={usdForm.note}
                    onChange={e => setUsdForm(p => ({ ...p, note: e.target.value }))} />
                </div>
                <button onClick={addUsdReceipt} style={btn(C.green)} disabled={loading}>录入到账</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Tab Bar */}
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: C.surface, borderTop: `1px solid ${C.border}`, display: "flex", zIndex: 20 }}>
        {([
          ["overview",    "概要", "⊙"],
          ["performance", "业绩", "↗"],
          ["payouts",     "发放", "¥"],
          ["entry",       "录入", "+"],
        ] as [MTab, string, string][]).map(([k, label, icon]) => (
          <button key={k} onClick={() => setTab(k)} style={{ flex: 1, padding: "10px 0 14px", background: "transparent", border: "none", cursor: "pointer", fontFamily: font, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
            <span style={{ fontSize: 18, color: tab === k ? C.blue : C.faint }}>{icon}</span>
            <span style={{ fontSize: 11, fontWeight: tab === k ? 700 : 400, color: tab === k ? C.blue : C.muted }}>{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
