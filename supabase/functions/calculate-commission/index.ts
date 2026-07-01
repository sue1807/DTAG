// supabase/functions/calculate-commission/index.ts
// 提成计算 Edge Function — 替代 FastAPI 后端
// 部署: supabase functions deploy calculate-commission

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── 计算公式（与已验证的Python逻辑完全一致）────────────────
function calcCommission(trade: any, fees: any, traderConfig: any) {
  const net  = trade.gross - trade.gateway_charge;
  const base = net * traderConfig.rate;

  let datafee: number;
  let settle:  number;
  let fxRate:  number;

  if (traderConfig.ccy === "AUD") {
    const asxEach   = fees.asx_aud / 2;
    const chixaEach = (fees.chixa_usd / 2) / fees.fx_aud_usd;  // USD → AUD
    datafee  = asxEach + chixaEach;
    settle   = base - trade.exe_fee - datafee;
    fxRate   = fees.fx_aud_usd;
  } else {
    // LULUSHI HKD — sec fee excluded from 可结算NET (matches historical records)
    datafee  = fees.hke_hkd;
    settle   = base - trade.exe_fee - datafee;
    fxRate   = fees.fx_hkd_usd;
  }

  const usdAmount  = settle * fxRate;
  const platfee    = traderConfig.platfee_usd;   // -75 or 0
  const monthlyUsd = usdAmount + platfee;

  return {
    net_native:     round4(net),
    base_native:    round4(base),
    datafee_native: round4(datafee),
    settle_native:  round4(settle),
    fx_rate:        fxRate,
    usd_amount:     round4(usdAmount),
    platfee_usd:    platfee,
    monthly_usd:    round4(monthlyUsd),
  };
}

function round4(n: number) {
  return Math.round(n * 10000) / 10000;
}

function verifySettlement(results: any[], settlement: any) {
  const audTraders = results.filter(r => r.ccy === "AUD");
  const hkdTraders = results.filter(r => r.ccy === "HKD");

  const calcAud = audTraders.reduce((sum, r) => sum + r.net_native, 0);
  const calcHkd = hkdTraders.reduce((sum, r) => sum + r.net_native, 0);

  const audDiff = Math.abs(calcAud - settlement.equity_aud);
  const hkdDiff = Math.abs(calcHkd - settlement.equity_hkd);
  const TOL = 0.05;

  return {
    aud: { calculated: round4(calcAud), settlement: settlement.equity_aud, diff: round4(audDiff), pass: audDiff <= TOL },
    hkd: { calculated: round4(calcHkd), settlement: settlement.equity_hkd, diff: round4(hkdDiff), pass: hkdDiff <= TOL },
    overall_pass: audDiff <= TOL && hkdDiff <= TOL,
  };
}

// ── Handler ───────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { action, period } = await req.json();

    // 1. Get trader configs
    const { data: traders } = await supabase.from("traders").select("*");
    const traderMap = Object.fromEntries(traders!.map((t: any) => [t.id, t]));

    // 2. Get fees for period
    const { data: fees, error: feesErr } = await supabase
      .from("period_fees").select("*").eq("period", period).single();
    if (feesErr || !fees) {
      return new Response(JSON.stringify({ error: `未找到 ${period} 费用配置，请先在「月度配置」录入` }), { status: 400, headers: corsHeaders });
    }

    // 3. Get trade records for period
    const { data: trades, error: tradesErr } = await supabase
      .from("trade_records").select("*").eq("period", period);
    if (tradesErr || !trades?.length) {
      return new Response(JSON.stringify({ error: `未找到 ${period} 交易数据，请先上传 CSV` }), { status: 400, headers: corsHeaders });
    }

    // 4. Calculate
    const results = trades.map((trade: any) => {
      const config = traderMap[trade.trader_id];
      const calc = calcCommission(trade, fees, config);
      return { trader_id: trade.trader_id, ccy: config.ccy, ...calc };
    });

    if (action === "calculate") {
      // Save as draft
      for (const r of results) {
        await supabase.from("commission_results").upsert(
          { ...r, period, status: "draft" },
          { onConflict: "trader_id,period" }
        );
      }
      return new Response(JSON.stringify({ success: true, period, status: "draft", results }), { headers: corsHeaders });
    }

    if (action === "verify") {
      const { data: sett } = await supabase
        .from("settlement_records").select("*").eq("period", period).single();
      if (!sett) {
        return new Response(JSON.stringify({ error: "未找到 Settlement 数据，请先录入" }), { status: 400, headers: corsHeaders });
      }
      const verification = verifySettlement(results, sett);
      return new Response(JSON.stringify({ success: true, verification }), { headers: corsHeaders });
    }

    if (action === "confirm") {
      // Confirm + write margin ledger
      for (const r of results) {
        // Update status
        await supabase.from("commission_results").upsert(
          { ...r, period, status: "confirmed", confirmed_at: new Date().toISOString() },
          { onConflict: "trader_id,period" }
        );

        // Check if margin_ledger entry already exists for this trader+period (idempotent)
        const { data: existing } = await supabase
          .from("margin_ledger")
          .select("id")
          .eq("trader_id", r.trader_id)
          .eq("period", period)
          .limit(1);

        if (existing && existing.length > 0) {
          // Already written — skip to avoid duplicate
          continue;
        }

        // Get current margin balance
        const { data: ledger } = await supabase
          .from("margin_ledger").select("amount_usd").eq("trader_id", r.trader_id);
        const prevBal = (ledger || []).reduce((s: number, e: any) => s + parseFloat(e.amount_usd), 0);
        const newBal  = prevBal + r.monthly_usd;

        // Write ledger entry
        await supabase.from("margin_ledger").insert({
          trader_id:     r.trader_id,
          period,
          entry_date:    `${period}-01`,
          type:          r.monthly_usd < 0 ? "deduct" : "commission",
          amount_usd:    r.monthly_usd,
          fx_rate:       r.fx_rate,
          balance_after: round4(newBal),
          note:          `${period} 提成结算`,
        });
      }
      return new Response(JSON.stringify({ success: true, period, status: "confirmed" }), { headers: corsHeaders });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers: corsHeaders });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
