// frontend/src/pages/TraderDashboard.tsx
import { useState, useEffect, useRef } from "react";
import { supabase, db, signOut } from "../lib/supabase";

const TRADER_META: Record<string, { name: string; ccy: string; color: string; exchange: string }> = {
  HONG045: { name: "王博",   ccy: "AUD", color: "#00C8FF", exchange: "ASX · CHIXA" },
  PENGCDU: { name: "马金斗", ccy: "AUD", color: "#00EF7A", exchange: "ASX · CHIXA" },
  LULUSHI: { name: "石路路", ccy: "HKD", color: "#FFB300", exchange: "HKEx" },
};

const f2 = (n: number) => Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function TraderDashboard({ traderId, onLogout }: { traderId: string; onLogout: () => void }) {
  const [tab, setTab]          = useState<"home"|"monthly"|"margin">("home");
  const [performance, setPerf] = useState<any[]>([]);
  const [payouts, setPayouts]  = useState<any[]>([]);
  const [balance, setBalance]  = useState<any>(null);
  const [ledger, setLedger]    = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [expandedPeriod, setExpandedPeriod] = useState<string|null>(null);
  const [tradeDetails, setTradeDetails] = useState<Record<string, any>>({});
  const [periodFees, setPeriodFees] = useState<Record<string, any>>({});
  const pullStartY   = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const meta  = TRADER_META[traderId] || { name: traderId, ccy: "—", color: "#00C8FF", exchange: "—" };
  const color = meta.color;

  const loadData = async () => {
    await Promise.all([
      supabase.from("commission_results")
        .select("*").eq("trader_id", traderId)
        .order("period", { ascending: false })
        .then(r => setPerf(r.data || [])),
      supabase.from("commission_payouts")
        .select("*").eq("trader_id", traderId)
        .order("payout_date", { ascending: false })
        .then(r => setPayouts(r.data || [])),
      db.getBalances().then(r => {
        const b = (r.data || []).find((x: any) => x.trader_id === traderId);
        setBalance(b);
      }),
      db.getLedger(traderId).then(r => setLedger(r.data || [])),
    ]);
    setLastUpdate(new Date());
  };

  useEffect(() => { loadData(); }, [traderId]);

  const toggleDetail = async (p: string) => {
    if (expandedPeriod === p) { setExpandedPeriod(null); return; }
    setExpandedPeriod(p);
    if (!tradeDetails[p]) {
      const { data } = await supabase.from("trade_records")
        .select("*").eq("trader_id", traderId).eq("period", p).single();
      if (!periodFees[p]) {
        const { data: fees } = await supabase.from("period_fees").select("fx_aud_usd,fx_hkd_usd").eq("period", p).single();
        if (fees) setPeriodFees(prev => ({ ...prev, [p]: fees }));
      }
      setTradeDetails(prev => ({ ...prev, [p]: data || null }));
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => { pullStartY.current = e.touches[0].clientY; };
  const handleTouchEnd   = async (e: React.TouchEvent) => {
    const diff = e.changedTouches[0].clientY - pullStartY.current;
    if (diff > 70 && (containerRef.current?.scrollTop || 0) <= 0 && !refreshing) {
      setRefreshing(true); await loadData(); setRefreshing(false);
    }
  };

  const balUsd      = parseFloat(balance?.balance_usd || 0);
  const balStatus   = balance?.status || "ok";
  const balColor    = balStatus === "danger" ? "#FF2847" : balStatus === "warning" ? "#FFB300" : "#00EF7A";
  const latestConfirmed = performance.find((c: any) => c.status === "confirmed") || performance[0];
  const latestPerf  = latestConfirmed;
  const totalPayCny = payouts.reduce((s, p) => s + parseFloat(p.cny_amount || 0), 0);

  const C = { bg:"#060A12", card:"#0D1829", border:"#182840", dim:"#4A6882", text:"#C4DAF0", green:"#00EF7A", red:"#FF2847" };
  const typeLabel: Record<string,string> = { deposit:"存入", deduct:"扣减", withdraw:"提取", commission:"提成结算" };

  return (
    <div style={{ position:"fixed", inset:0, background:C.bg, color:C.text, fontFamily:"system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif", display:"flex", flexDirection:"column" }}>

      {/* Header */}
      <div style={{ background:"#0A1422", borderBottom:`1px solid ${C.border}`, padding:"14px 20px 12px", flexShrink:0 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <div style={{ width:42, height:42, borderRadius:"50%", background:color+"22", border:`2px solid ${color}55`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, fontWeight:900, color }}>
              {meta.name[0]}
            </div>
            <div>
              <div style={{ fontSize:18, fontWeight:800, color, lineHeight:1.2 }}>{meta.name}</div>
              <div style={{ fontSize:11, color:C.dim, marginTop:1 }}>{traderId} · {meta.exchange}</div>
            </div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            {refreshing && <span style={{ fontSize:11, color:C.dim }}>刷新中…</span>}
            <button onClick={() => { signOut(); onLogout(); }}
              style={{ background:"transparent", border:`1px solid ${C.border}`, color:C.dim, padding:"6px 16px", borderRadius:20, cursor:"pointer", fontSize:13 }}>
              退出
            </button>
          </div>
        </div>
      </div>

      {/* 主内容 */}
      <div ref={containerRef} onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}
        style={{ flex:1, overflowY:"auto", padding:"16px 14px 20px" } as any}>

        {refreshing && <div style={{ textAlign:"center", padding:"4px 0 10px", fontSize:12, color:C.dim }}>↻ 刷新中...</div>}

        {/* ══ HOME ══ */}
        {tab === "home" && <>
          {/* 保证金余额 */}
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderTop:`3px solid ${balColor}`, borderRadius:18, padding:"24px 20px 20px", marginBottom:12 }}>
            <div style={{ fontSize:12, color:C.dim, marginBottom:10, letterSpacing:0.5 }}>💰 保证金余额</div>
            <div style={{ fontSize:48, fontWeight:900, color:balColor, letterSpacing:-2, lineHeight:1 }}>${f2(balUsd)}</div>
            <div style={{ fontSize:13, color:C.dim, marginTop:8 }}>
              USD · 更新于 {lastUpdate.toLocaleTimeString("zh-CN", { hour:"2-digit", minute:"2-digit" })}
            </div>
            {balStatus === "warning" && (
              <div style={{ marginTop:14, background:"#FFB30018", border:"1px solid #FFB30055", borderRadius:12, padding:"12px 14px", fontSize:14, color:"#FFB300", lineHeight:1.7 }}>
                ⚠️ 余额低于留存警戒线<br />请联系管理员补充
              </div>
            )}
            {balStatus === "danger" && (
              <div style={{ marginTop:14, background:"#FF284718", border:"1px solid #FF284755", borderRadius:12, padding:"12px 14px", fontSize:14, color:"#FF2847", lineHeight:1.7 }}>
                🚨 余额已耗尽<br />请立即联系管理员充值
              </div>
            )}
          </div>

          {/* 本月业绩 + 累计发放 */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:12 }}>
            <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:16, padding:"18px 14px" }}>
              <div style={{ fontSize:12, color:C.dim, marginBottom:8 }}>最新月业绩</div>
              <div style={{ fontSize:26, fontWeight:900, color:(latestPerf?.monthly_usd||0)>=0 ? C.green : C.red, lineHeight:1 }}>
                {(latestPerf?.monthly_usd||0)>=0 ? "+" : "−"}${f2(Math.abs(latestPerf?.monthly_usd||0))}
              </div>
              <div style={{ fontSize:11, color:C.dim, marginTop:6 }}>USD · {latestPerf?.period || "暂无"}</div>
            </div>
            <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:16, padding:"18px 14px" }}>
              <div style={{ fontSize:12, color:C.dim, marginBottom:8 }}>累计已发放</div>
              <div style={{ fontSize:26, fontWeight:900, color:C.green, lineHeight:1 }}>
                ¥{Math.round(totalPayCny).toLocaleString()}
              </div>
              <div style={{ fontSize:11, color:C.dim, marginTop:6 }}>CNY · {payouts.length} 笔</div>
            </div>
          </div>

          <div style={{ textAlign:"center", marginTop:12, fontSize:12, color:C.dim }}>向下拉动页面可刷新数据</div>
        </>}

        {/* ══ MONTHLY PERFORMANCE ══ */}
        {tab === "monthly" && <>
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:16, padding:"18px 16px", marginBottom:12, display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            <div>
              <div style={{ fontSize:12, color:C.dim, marginBottom:6 }}>最新已确认</div>
              <div style={{ fontSize:22, fontWeight:900, color:(latestConfirmed?.monthly_usd||0)>=0?C.green:C.red }}>
                {(latestConfirmed?.monthly_usd||0)>=0?"+":"−"}${f2(Math.abs(latestConfirmed?.monthly_usd||0))}
              </div>
              <div style={{ fontSize:11, color:C.dim, marginTop:4 }}>{latestConfirmed?.period || "暂无"} · USD</div>
            </div>
            <div>
              <div style={{ fontSize:12, color:C.dim, marginBottom:6 }}>累计已发放</div>
              <div style={{ fontSize:22, fontWeight:900, color:C.green }}>¥{Math.round(totalPayCny).toLocaleString()}</div>
              <div style={{ fontSize:11, color:C.dim, marginTop:4 }}>CNY · {payouts.length} 笔</div>
            </div>
          </div>

          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:16, overflow:"hidden" }}>
            <div style={{ padding:"14px 16px 10px", fontSize:13, color:C.dim, fontWeight:600 }}>所有月份业绩</div>
            {performance.length === 0 && (
              <div style={{ padding:"24px 16px", fontSize:13, color:C.dim, textAlign:"center" }}>暂无数据</div>
            )}
            {performance.map((c: any, i: number) => {
              const pos = c.monthly_usd >= 0;
              const isDraft = c.status !== "confirmed";
              const hasPayout = payouts.some((p: any) => p.period_covered?.includes(c.period));
              const statusLabel = hasPayout ? "已发放" : isDraft ? "待确认" : "计提提成";
              const statusColor = hasPayout ? C.green : isDraft ? "#4A6882" : "#FFB300";
              const isExpanded = expandedPeriod === c.period;
              const d = tradeDetails[c.period];
              return (
                <div key={c.period} style={{ borderTop:`1px solid ${C.border}`, background: i%2 ? "#ffffff04" : "transparent", opacity: isDraft ? 0.8 : 1 }}>
                  <div onClick={() => toggleDetail(c.period)}
                    style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"14px 16px", cursor:"pointer" }}>
                    <div>
                      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                        <span style={{ fontSize:15, fontWeight:700 }}>{c.period}</span>
                        <span style={{ fontSize:10, padding:"2px 7px", borderRadius:10, background:statusColor+"22", color:statusColor, fontWeight:600 }}>{statusLabel}</span>
                      </div>
                      <div style={{ fontSize:12, color:C.dim }}>
                        可结算 {parseFloat(c.settle_native||0).toFixed(2)} {meta.ccy}
                      </div>
                    </div>
                    <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                      <div style={{ textAlign:"right" }}>
                        <div style={{ fontSize:22, fontWeight:900, color: isDraft ? C.dim : pos ? C.green : C.red }}>
                          {pos ? "+" : "−"}${f2(Math.abs(c.monthly_usd))}
                        </div>
                        <div style={{ fontSize:11, color:C.dim, marginTop:2 }}>USD</div>
                      </div>
                      <span style={{ color:C.dim, fontSize:14, transition:"transform 0.2s", display:"inline-block", transform: isExpanded ? "rotate(180deg)" : "none" }}>▾</span>
                    </div>
                  </div>
                  {isExpanded && (
                    <div style={{ padding:"10px 16px 16px", background:"#ffffff06", borderTop:`1px solid ${C.border}` }}>
                      {d === undefined && <div style={{ fontSize:12, color:C.dim }}>加载中…</div>}
                      {d === null && <div style={{ fontSize:12, color:C.dim }}>暂无原始数据</div>}
                      {d && (() => {
                        const ccy = d.ccy || meta.ccy;
                        const gross = parseFloat(d.gross || 0);
                        const gw    = parseFloat(d.gateway_charge || 0);
                        const net   = gross - gw;
                        const exe   = parseFloat(d.exe_fee || 0);
                        const isAud = ccy === "AUD";
                        const entLabel = isAud
                          ? "ASX 132.22 AUD + CHIXA 64.50 USD"
                          : "HKE 451.70 HKD";
                        const officeUsd = isAud ? 75 : 0;
                        const fees = periodFees[c.period];
                        const platfeeUsd = isAud ? -75 : 0;
                        const settleN = parseFloat(c.settle_native || "0");
                        const monthlyU = parseFloat(c.monthly_usd || "0");
                        const backCalc = settleN !== 0 ? (monthlyU - platfeeUsd) / settleN : 0;
                        const fxRate = c.fx_rate
                          || (isAud ? fees?.fx_aud_usd : fees?.fx_hkd_usd)
                          || (backCalc > 0 && backCalc < 100 ? backCalc : null);
                        return (
                          <div style={{ display:"grid", gap:5 }}>
                            {[
                              ["Gross",    gross, ccy, false],
                              ["Gateway",  gw,    ccy, true],
                              ["NET",      net,   ccy, false],
                              ["Exe Fee",  exe,   ccy, true],
                            ].map(([label, val, unit, neg]) => (
                              <div key={label as string} style={{ display:"flex", justifyContent:"space-between", fontSize:13 }}>
                                <span style={{ color:C.dim }}>{label}</span>
                                <span style={{ color: label==="NET" ? (net>=0?C.green:C.red) : C.text }}>
                                  {neg ? "−" : ""}{Math.abs(val as number).toFixed(2)} <span style={{ color:C.dim, fontSize:11 }}>{unit}</span>
                                </span>
                              </div>
                            ))}
                            {fxRate && (
                              <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, paddingTop:2 }}>
                                <span style={{ color:C.dim }}>× 汇率 ({ccy}/USD)</span>
                                <span style={{ color:C.text, fontWeight:600 }}>{parseFloat(fxRate).toFixed(6)}</span>
                              </div>
                            )}
                            <div style={{ borderTop:`1px solid ${C.border}`, paddingTop:6, marginTop:2, display:"flex", justifyContent:"space-between", fontSize:12 }}>
                              <span style={{ color:C.dim }}>权益扣项</span>
                              <span style={{ color:"#FFB300" }}>{entLabel}</span>
                            </div>
                            {isAud && (
                              <div style={{ display:"flex", justifyContent:"space-between", fontSize:12 }}>
                                <span style={{ color:C.dim }}>Office Fee</span>
                                <span style={{ color:C.text }}>−{officeUsd} <span style={{ color:C.dim, fontSize:11 }}>USD</span></span>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>}

        {/* ══ MARGIN ══ */}
        {tab === "margin" && <>
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderTop:`3px solid ${balColor}`, borderRadius:18, padding:"22px 20px", marginBottom:14 }}>
            <div style={{ fontSize:12, color:C.dim, marginBottom:8 }}>当前保证金余额</div>
            <div style={{ fontSize:44, fontWeight:900, color:balColor, letterSpacing:-1, lineHeight:1 }}>${f2(balUsd)}</div>
            <div style={{ fontSize:13, color:C.dim, marginTop:6 }}>USD</div>
          </div>
          <div style={{ fontSize:13, color:C.dim, marginBottom:10 }}>流水记录</div>
          {ledger.filter((e:any) => e.type !== "commission").length === 0 && (
            <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:16, padding:30, textAlign:"center", color:C.dim }}>暂无记录</div>
          )}
          {ledger.filter((e:any) => e.type !== "commission").map((e: any) => {
            const isPos = e.amount_usd > 0;
            const ec    = isPos ? C.green : "#FF2847";
            return (
              <div key={e.id} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:"14px 16px", marginBottom:8, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div style={{ flex:1, marginRight:12 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:5 }}>
                    <span style={{ fontSize:11, padding:"3px 10px", borderRadius:20, background:ec+"20", color:ec, fontWeight:700 }}>
                      {typeLabel[e.type] || e.type}
                    </span>
                    <span style={{ fontSize:12, color:C.dim }}>{e.entry_date}</span>
                  </div>
                  {e.note && <div style={{ fontSize:13, color:C.dim, marginBottom:3 }}>{e.note}</div>}
                  <div style={{ fontSize:12, color:C.dim }}>余额 ${f2(parseFloat(e.balance_after||0))}</div>
                </div>
                <div style={{ fontSize:26, fontWeight:900, color:ec, flexShrink:0 }}>
                  {isPos ? "+" : "−"}${f2(Math.abs(e.amount_usd))}
                </div>
              </div>
            );
          })}
        </>}
      </div>

      {/* 底部导航 */}
      <div style={{ background:"#0A1422", borderTop:`1px solid ${C.border}`, display:"flex", flexShrink:0, paddingBottom:"env(safe-area-inset-bottom)" }}>
        {[
          { k:"home",    icon:"🏠", label:"首页" },
          { k:"monthly", icon:"📊", label:"每月业绩" },
          { k:"margin",  icon:"🏦", label:"保证金" },
        ].map(t => (
          <button key={t.k} onClick={() => setTab(t.k as any)}
            style={{ flex:1, padding:"12px 0 8px", background:"transparent", border:"none", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:3, outline:"none" }}>
            <span style={{ fontSize:24 }}>{t.icon}</span>
            <span style={{ fontSize:11, color: tab===t.k ? color : "#4A6882", fontWeight: tab===t.k ? 700 : 400 }}>{t.label}</span>
            {tab === t.k && <div style={{ width:24, height:2, background:color, borderRadius:1 }} />}
          </button>
        ))}
      </div>
    </div>
  );
}
