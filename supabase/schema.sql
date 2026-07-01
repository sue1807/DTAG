-- ============================================================
--  交易室管理系统 — Supabase Schema
--  在 Supabase Dashboard → SQL Editor 全部粘贴运行
-- ============================================================

-- ── 1. 交易员基础配置 ────────────────────────────────────────
CREATE TABLE traders (
    id          TEXT PRIMARY KEY,           -- HONG045 / PENGCDU / LULUSHI
    name        TEXT NOT NULL,              -- 王博 / 马金斗 / 石路路
    ccy         TEXT NOT NULL,              -- AUD / HKD
    rate        NUMERIC(4,2) NOT NULL,      -- 0.80 / 1.00
    exchange    TEXT NOT NULL,
    platfee_usd NUMERIC(10,2) DEFAULT 0,    -- -75 / 0
    active      BOOLEAN DEFAULT TRUE
);

-- ── 2. 每月费用配置（汇率+数据费）────────────────────────────
CREATE TABLE period_fees (
    period      TEXT PRIMARY KEY,           -- 2026-01
    asx_aud     NUMERIC(12,4) DEFAULT 264.44,
    chixa_usd   NUMERIC(12,4) DEFAULT 129.00,
    hke_hkd     NUMERIC(12,4) DEFAULT 451.70,
    office_usd  NUMERIC(12,4) DEFAULT 150.00,
    wire_usd    NUMERIC(12,4) DEFAULT 0,
    fx_aud_usd  NUMERIC(12,8) NOT NULL,
    fx_hkd_usd  NUMERIC(12,8) NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── 3. 交易原始数据（来自CSV）────────────────────────────────
CREATE TABLE trade_records (
    id              SERIAL PRIMARY KEY,
    trader_id       TEXT REFERENCES traders(id),
    period          TEXT NOT NULL,
    gross           NUMERIC(14,4),
    gateway_charge  NUMERIC(14,4),
    sec_fee         NUMERIC(14,4) DEFAULT 0,
    exe_fee         NUMERIC(14,4) DEFAULT 0,
    ccy             TEXT,
    source_file     TEXT,
    uploaded_at     TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(trader_id, period)
);

-- ── 4. 提成计算结果 ──────────────────────────────────────────
CREATE TABLE commission_results (
    id              SERIAL PRIMARY KEY,
    trader_id       TEXT REFERENCES traders(id),
    period          TEXT NOT NULL,
    net_native      NUMERIC(14,4),
    base_native     NUMERIC(14,4),
    datafee_native  NUMERIC(14,4),
    settle_native   NUMERIC(14,4),
    fx_rate         NUMERIC(12,8),
    usd_amount      NUMERIC(14,4),
    platfee_usd     NUMERIC(10,2),
    monthly_usd     NUMERIC(14,4),
    status          TEXT DEFAULT 'draft',   -- draft → confirmed
    confirmed_at    TIMESTAMPTZ,
    UNIQUE(trader_id, period)
);

-- ── 5. Settlement PDF 数据（手动录入）────────────────────────
CREATE TABLE settlement_records (
    period              TEXT PRIMARY KEY,
    equity_aud          NUMERIC(14,2),
    cut_aud             NUMERIC(14,2),
    net_aud             NUMERIC(14,2),
    exe_aud             NUMERIC(14,2),
    equity_hkd          NUMERIC(14,2),
    cut_hkd             NUMERIC(14,2),
    net_hkd             NUMERIC(14,2),
    exe_hkd             NUMERIC(14,2),
    total_usd           NUMERIC(14,2),
    post_exchange_usd   NUMERIC(14,2),
    fx_notes            TEXT,
    aud_ok              BOOLEAN DEFAULT FALSE,
    hkd_ok              BOOLEAN DEFAULT FALSE,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ── 6. 保证金流水（USD统一）─────────────────────────────────
CREATE TABLE margin_ledger (
    id              SERIAL PRIMARY KEY,
    trader_id       TEXT REFERENCES traders(id),
    period          TEXT,
    entry_date      DATE NOT NULL,
    type            TEXT NOT NULL,          -- deposit/deduct/withdraw/commission
    amount_usd      NUMERIC(14,4) NOT NULL, -- 正=进, 负=出
    fx_rate         NUMERIC(12,8),
    balance_after   NUMERIC(14,4),
    note            TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── 7. 用户账号（关联 Supabase Auth）────────────────────────
CREATE TABLE user_profiles (
    id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    trader_id   TEXT REFERENCES traders(id), -- NULL = 管理员
    role        TEXT NOT NULL DEFAULT 'trader',
    name        TEXT
);

-- ============================================================
--  初始数据
-- ============================================================
INSERT INTO traders (id, name, ccy, rate, exchange, platfee_usd) VALUES
    ('HONG045', '王博',   'AUD', 0.80, 'ASX',       -75.00),
    ('PENGCDU', '马金斗', 'AUD', 0.80, 'ASX·CHIXA', -75.00),
    ('LULUSHI', '石路路', 'HKD', 1.00, 'HKEx',        0.00);

-- Jan 2026 费用（已验证）
INSERT INTO period_fees (period, asx_aud, chixa_usd, hke_hkd, office_usd, wire_usd, fx_aud_usd, fx_hkd_usd) VALUES
    ('2026-01', 264.44, 129.00, 451.70, 150.00, 25.00, 0.67444800, 0.12451659);

-- Dec 2025 结算余额（历史起始点）
INSERT INTO margin_ledger (trader_id, period, entry_date, type, amount_usd, fx_rate, balance_after, note) VALUES
    ('HONG045', '2025-12', '2025-12-31', 'deposit', 1941.7757, 1.0, 1941.7757, 'Dec 2025 历史起始余额'),
    ('PENGCDU', '2025-12', '2025-12-31', 'deposit', 3184.8662, 1.0, 3184.8662, 'Dec 2025 历史起始余额'),
    ('LULUSHI', '2025-12', '2025-12-31', 'deposit',  247.9926, 1.0,  247.9926, 'Dec 2025 历史起始余额');

-- ============================================================
--  Row Level Security（数据隔离）
-- ============================================================
ALTER TABLE trade_records      ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE margin_ledger      ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlement_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE period_fees        ENABLE ROW LEVEL SECURITY;

-- 管理员（trader_id IS NULL）看所有数据
CREATE POLICY "admin_full_access" ON trade_records
    FOR ALL USING (
        EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
    );
CREATE POLICY "admin_full_access" ON commission_results
    FOR ALL USING (
        EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
    );
CREATE POLICY "admin_full_access" ON margin_ledger
    FOR ALL USING (
        EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
    );
CREATE POLICY "admin_full_access" ON settlement_records
    FOR ALL USING (
        EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
    );
CREATE POLICY "admin_full_access" ON period_fees
    FOR ALL USING (
        EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
    );

-- 交易员只读自己的数据
CREATE POLICY "trader_own_trades" ON trade_records
    FOR SELECT USING (
        trader_id = (SELECT trader_id FROM user_profiles WHERE id = auth.uid())
    );
CREATE POLICY "trader_own_commission" ON commission_results
    FOR SELECT USING (
        trader_id = (SELECT trader_id FROM user_profiles WHERE id = auth.uid())
        AND status = 'confirmed'
    );
CREATE POLICY "trader_own_margin" ON margin_ledger
    FOR SELECT USING (
        trader_id = (SELECT trader_id FROM user_profiles WHERE id = auth.uid())
    );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'commission_results'
      AND policyname = 'trader_own_draft_commission'
  ) THEN
    CREATE POLICY "trader_own_draft_commission" ON commission_results
      FOR SELECT
      USING (
        trader_id = (
          SELECT trader_id
          FROM user_profiles
          WHERE id = auth.uid()
        )
        AND status = 'draft'
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'period_fees'
      AND policyname = 'trader_read_period_fees'
  ) THEN
    CREATE POLICY "trader_read_period_fees" ON period_fees
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1
          FROM user_profiles
          WHERE id = auth.uid()
            AND role = 'trader'
        )
      );
  END IF;
END $$;

-- ============================================================
--  保证金余额视图
-- ============================================================
CREATE VIEW margin_balances AS
SELECT
    t.id    AS trader_id,
    t.name,
    t.ccy,
    COALESCE(SUM(ml.amount_usd), 0)  AS balance_usd,
    MAX(ml.entry_date)               AS last_entry,
    CASE
        WHEN COALESCE(SUM(ml.amount_usd), 0) <= 0   THEN 'danger'
        WHEN COALESCE(SUM(ml.amount_usd), 0) < 200  THEN 'warning'
        ELSE 'ok'
    END AS status
FROM traders t
LEFT JOIN margin_ledger ml ON ml.trader_id = t.id
GROUP BY t.id, t.name, t.ccy;
