// supabase/functions/parse-csv/index.ts
// CSV 解析 Edge Function
// 部署: supabase functions deploy parse-csv

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const KNOWN_TRADERS = new Set(["HONG045", "PENGCDU", "LULUSHI"]);

function toNum(val: string | undefined): number {
  if (!val || val.trim() === "" || val.trim() === "-") return 0;
  return parseFloat(val.replace(/,/g, "").trim()) || 0;
}

function parseTraderCsv(text: string): Record<string, any> {
  const lines = text.trim().split("\n");
  const headers = lines[0].split(",").map(h => h.trim().replace(/"/g, ""));

  const colIdx = (name: string) => headers.findIndex(h => h === name || h.includes(name));
  const tidCol = colIdx("Trader ID");
  const grossCol = colIdx("Gross");
  const gwCol    = colIdx("Gateway Charge");
  const secCol   = colIdx("Sec Fee");
  const exeCol   = colIdx("Exe Fee");
  const ccyCol   = colIdx("Currency");

  const result: Record<string, any> = {};

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map(c => c.trim().replace(/"/g, ""));
    const tid  = cols[tidCol]?.trim();
    if (!tid || !KNOWN_TRADERS.has(tid)) continue;

    if (!result[tid]) {
      result[tid] = { trader_id: tid, ccy: cols[ccyCol] || "", gross: 0, gateway_charge: 0, sec_fee: 0, exe_fee: 0 };
    }
    result[tid].gross          += toNum(cols[grossCol]);
    result[tid].gateway_charge += toNum(cols[gwCol]);
    result[tid].sec_fee        += toNum(cols[secCol]);
    result[tid].exe_fee        += toNum(cols[exeCol]);
  }

  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const formData = await req.formData();
    const file     = formData.get("file") as File;
    const period   = formData.get("period") as string;
    const confirm  = formData.get("confirm") === "true";

    if (!file || !period) {
      return new Response(JSON.stringify({ error: "需要 file 和 period 参数" }), { status: 400, headers: corsHeaders });
    }

    const text   = await file.text();
    const parsed = parseTraderCsv(text);

    if (!confirm) {
      // Preview only - don't save
      return new Response(JSON.stringify({ success: true, preview: parsed, traders_found: Object.keys(parsed) }), { headers: corsHeaders });
    }

    // Save to database
    const inserted: string[] = [];
    for (const [tid, d] of Object.entries(parsed)) {
      await supabase.from("trade_records").upsert(
        { trader_id: tid, period, gross: d.gross, gateway_charge: d.gateway_charge, sec_fee: d.sec_fee, exe_fee: d.exe_fee, ccy: d.ccy, source_file: file.name },
        { onConflict: "trader_id,period" }
      );
      inserted.push(tid);
    }

    return new Response(JSON.stringify({ success: true, period, inserted }), { headers: corsHeaders });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
