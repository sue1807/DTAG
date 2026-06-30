-- 添加 Adjustment SUB TOTAL 字段到 settlement 表
ALTER TABLE settlement
ADD COLUMN adjustment_sub_total_aud NUMERIC(15, 2),
ADD COLUMN adjustment_sub_total_hkd NUMERIC(15, 2),
ADD COLUMN adjustment_sub_total_usd NUMERIC(15, 2);
