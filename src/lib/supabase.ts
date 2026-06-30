// frontend/src/lib/supabase.ts
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

// ── Auth helpers ─────────────────────────────────────────────
export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;

  const { data: profile } = await supabase
    .from("user_profiles").select("*").eq("id", data.user.id).single();

  return { user: data.user, session: data.session, profile };
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function getProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("user_profiles").select("*").eq("id", user.id).single();
  return { user, profile };
}

// ── Edge Function caller ─────────────────────────────────────
export async function callFunction(name: string, body: any) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token}`,
      apikey: SUPABASE_ANON,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function callFunctionForm(name: string, formData: FormData) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: { 
      Authorization: `Bearer ${session?.access_token}`,
      apikey: SUPABASE_ANON,
    },
    body: formData,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ── DB helpers ───────────────────────────────────────────────
export const db = {
  // Trades
  getTrades:     (period?: string) => period
    ? supabase.from("trade_records").select("*").eq("period", period)
    : supabase.from("trade_records").select("*").order("period", { ascending: false }),

  // Commission
  getCommissions: (period?: string) => period
    ? supabase.from("commission_results").select("*, traders(name,ccy)").eq("period", period)
    : supabase.from("commission_results").select("*, traders(name,ccy)").order("period", { ascending: false }),

  // Settlement
  getSettlement: (period: string) =>
    supabase.from("settlement_records").select("*").eq("period", period).single(),
  upsertSettlement: (data: any) =>
    supabase.from("settlement_records").upsert(data, { onConflict: "period" }),

  // Margin
  getBalances: () => supabase.from("margin_balances").select("*"),
  getLedger:   (traderId?: string) => traderId
    ? supabase.from("margin_ledger").select("*").eq("trader_id", traderId).order("created_at", { ascending: false })
    : supabase.from("margin_ledger").select("*").order("created_at", { ascending: false }),

  addMarginEntry: async (entry: {
    trader_id: string; entry_date: string; type: string;
    amount_usd: number; fx_rate: number; note: string; period?: string;
  }) => {
    const sign = entry.type === "deposit" ? 1 : -1;
    const amount = sign * Math.abs(entry.amount_usd);
    const { data: ledger } = await supabase.from("margin_ledger").select("amount_usd").eq("trader_id", entry.trader_id);
    const prev = (ledger || []).reduce((s: number, r: any) => s + parseFloat(r.amount_usd), 0);
    return supabase.from("margin_ledger").insert({ ...entry, amount_usd: amount, balance_after: prev + amount });
  },
  deleteMarginEntry: (id: number) => supabase.from("margin_ledger").delete().eq("id", id),

  // Period fees
  getFees: (period: string) => supabase.from("period_fees").select("*").eq("period", period).single(),
  upsertFees: (data: any) => supabase.from("period_fees").upsert(data, { onConflict: "period" }),

  // Traders
  getTraders: () => supabase.from("traders").select("*"),
};
