# 交易室提成管理系统 — DTPPro8

交易室 31O-1232（Real Trading / DTTW Metro）专用提成计算与保证金管理系统。

**访问地址：** https://sue1807.github.io/DTPPro8/

---

## 系统架构

| 层级 | 技术 | 用途 |
|------|------|------|
| 前端 | React + Vite + TypeScript | 管理员后台 + 交易员移动端 |
| 数据库 | Supabase (PostgreSQL) | 数据存储、用户认证、RLS 权限控制 |
| 后端逻辑 | Supabase Edge Functions (Deno) | CSV 解析、提成计算 |
| 托管 | GitHub Pages | 静态前端部署 |

---

## 交易员配置

| Trader ID | 姓名 | 市场 | 币种 | 提成比例 | 留存保证金 |
|-----------|------|------|------|---------|----------|
| HONG045 | 王博 | ASX · CHIXA | AUD | 80% | $1,000 USD |
| PENGCDU | 马金斗 | ASX · CHIXA | AUD | 80% | $1,000 USD |
| LULUSHI | 石路路 | HKE | HKD | 100% | $500 USD |

---

## 用户账号

| 账号 | 角色 |
|------|------|
| admin@trading.com | 管理员 |
| hong045@trading.com | 交易员（仅查看本人）|
| pengcdu@trading.com | 交易员（仅查看本人）|
| lulushi@trading.com | 交易员（仅查看本人）|

---

## 核心计算公式

### 一、提成计算（三个层级）

每个月每个交易员有三个层级的数据，概念不同：

```
业绩提成(USD)  = 可结算NET × 汇率          ← 交易员当月赚到的原始金额（不扣 office fee）
计提提成(USD)  = 业绩提成 + platfee_usd    ← 实际记入保证金账户的金额（AUD 扣 −$75 office fee）
实发提成(USD)  = 保证金余额 − 留存保证金    ← 实际打出去的现金（余额超过留存线才能发放）
```

> 石路路某些月份：业绩提成有值，但余额不超过留存保证金 $500，计提有记录，实发 = $0。

#### AUD 交易员（王博 HONG045 / 马金斗 PENGCDU）

```
NET           = Gross − Gateway Charge
Base          = NET × 80%

Entitlements  = (ASX_AUD ÷ 2) + (CHIXA_USD ÷ 2 ÷ fx_aud_usd)
              = 132.22 AUD + (64.50 USD ÷ fx_aud_usd) AUD
              （每人各承担 ASX 和 CHIXA 各一半，CHIXA 按当月汇率换算为 AUD）

可结算 NET    = Base − Exe Fee − Entitlements

业绩提成(USD) = 可结算 NET × fx_aud_usd
计提提成(USD) = 业绩提成 − 75             （Office Fee $150 各承担一半）
```

#### HKD 交易员（石路路 LULUSHI）

```
NET           = Gross − Gateway Charge
Base          = NET × 100%

Entitlements  = 451.70 HKD（HKE 数据费，石路路独自承担）

可结算 NET    = Base − Exe Fee − 451.70

业绩提成(USD) = 可结算 NET × fx_hkd_usd
计提提成(USD) = 业绩提成                  （无 Office Fee，platfee = 0）
```

---

### 二、交易室月度利润

```
利润 = post_exchange_usd − 计提提成合计（可提款部分）− wire_fees_usd
```

| 字段 | 含义 | 来源 |
|------|------|------|
| `post_exchange_usd` | 总部结算后交易室可支配的 USD 总额 | Settlement PDF 手动录入 |
| 计提提成合计 | 当月各交易员 `monthly_usd` 之和，按余额门槛筛选 | `commission_results.monthly_usd` |
| `wire_fees_usd` | 当月电汇手续费 | Settlement 录入 |

**计提提成计入规则（按该月末保证金余额判断）：**

| 情况 | monthly_usd 正数 | monthly_usd 负数 |
|------|----------------|----------------|
| 余额 > 留存保证金（可提款） | 全额计入成本 | 计入亏损 |
| 余额 ≤ 留存保证金（不可提款） | **$0**（钱仍在交易室） | 计入亏损 |

> 石路路余额长期低于 $500 留存线，正数月份不计入利润成本；若月度为负数（业绩亏损），则算作交易室亏损。

---

### 三、利润分析面板（Settlement Tab 内）

每个月的 Settlement 页面展示当月利润明细：

**汇总栏：** Post Exchange → 计提提成（可提款部分）→ Wire Fee → 交易室净利

**每个交易员卡片显示：**
- 可结算 NET（原币）
- 计提提成（monthly_usd）
- 计入利润：余额达门槛 → 显示金额；未达门槛正数 → "未达门槛"；负数 → 计入亏损

---

### 四、Settlement 核对公式

```
AUD Equity = Σ(Gross − Gateway Charge)            所有 AUD 交易员合计
HKD Equity = Gross − Gateway Charge − Sec Fee     LULUSHI（Sec Fee 不计入 Equity）

平台抽成：
  Platform Cut = Equity × 15%
  Net 85%      = Equity × 85%
```

> 核对通过标准：计算值与 PDF 差值 < 0.05

---

## 费用配置（固定值）

| 费用项 | 总金额 | 币种 | 分摊方式 |
|--------|--------|------|---------|
| ASX 数据费 | 264.44 | AUD | 王博 + 马金斗 各 132.22 |
| CHIXA 数据费 | 129.00 | USD | 王博 + 马金斗 各 64.50（换算为 AUD）|
| HKE 数据费 | 451.70 | HKD | 石路路独自承担 |
| Office 费 | 150.00 | USD | 王博 −75，马金斗 −75；石路路 $0 |
| Wire 费 | 实际发生 | USD | 交易室承担，不扣交易员 |

---

## 保证金规则

| 交易员 | 留存保证金 | 可发放条件 |
|--------|----------|-----------|
| 王博 / 马金斗 | $1,000 USD | 余额 > $1,000 才可发放 |
| 石路路 | $500 USD | 余额 > $500 才可发放 |

```
账户总余额  = 初始存入 + 累计计提确认 − 累计实发提取
可发放金额  = 账户总余额 − 留存保证金（若 ≤ 0 则不发放）
CNY 到账    = 可发放金额 × USD/CNY 当日汇率
```

---

## 数据库表结构

| 表名 | 说明 | 关键字段 |
|------|------|---------|
| `traders` | 交易员基本信息 | id, name, ccy, rate, platfee_usd, reserve |
| `period_fees` | 月度费用与汇率配置 | period, fx_aud_usd, fx_hkd_usd, asx_aud, chixa_usd, hke_hkd |
| `trade_records` | 每月 CSV 汇总 | trader_id, period, gross, gateway_charge, exe_fee |
| `commission_results` | 提成计算结果 | trader_id, period, settle_native, monthly_usd, status(draft/confirmed) |
| `margin_ledger` | 保证金流水 | trader_id, period, type(deposit/commission/deduct/withdraw), amount_usd |
| `margin_balances` | 视图：当前余额 | trader_id, balance_usd |
| `settlement_records` | Settlement PDF 录入 | period, post_exchange_usd, wire_fees_usd, equity_aud/hkd, net_aud/hkd |
| `commission_payouts` | 提成实发记录 | trader_id, payout_date, settle_usd, fx_cny, cny_amount, period_covered |
| `usd_bank_receipts` | 美元到账记录 | receipt_date, amount_usd, source, is_settled |
| `erp_ledger` | ERP 账户台账 | entry_date, type(initial/settlement_deposit/bank_deposit/withdrawal), amount_usd |
| `user_profiles` | 用户角色 | id, role(admin/trader), trader_id |

### commission_results 字段说明

| 字段 | 含义 |
|------|------|
| `settle_native` | 可结算 NET（原币，AUD 或 HKD） |
| `monthly_usd` | 计提提成 USD（= 业绩提成 + platfee，AUD 扣 −$75） |
| `status` | draft（草稿）/ confirmed（已确认，已写入保证金） |

### commission_payouts 字段说明

| 字段 | 含义 |
|------|------|
| `settle_usd` | 实发金额 USD |
| `fx_cny` | 发放时 USD/CNY 汇率 |
| `cny_amount` | 实际到账人民币 |
| `payout_date` | 发放日期（用于利润归期） |
| `period_covered` | 本次发放覆盖的业绩月份（如 "2026-01,2026-02"，仅供参考） |

---

## 月度操作流程

```
① 上传 CSV（交易业绩 Tab）
   → 从 DTTW Metro 导出 TRADER_TRADING.csv
   → AUD 文件（HONG045 + PENGCDU）和 HKD 文件（LULUSHI）分两次上传
   → 右上角先选好月份

② 录入 Settlement（Settlement Tab）
   → 上传 Settlement PDF 自动解析
   → 核对数据后保存
   → post_exchange_usd = 总部结算后交易室可支配的 USD 总额

③ 确认结算参数（结算参数 Tab）
   → 确认 AUD/USD、HKD/USD 汇率已填入

④ 提成计算（交易业绩 Tab 下方）
   → ① 计算：生成草稿（写入 commission_results，status=draft）
   → ② 核对：对比 Settlement PDF（差值 < 0.05 通过）
   → ③ 确认锁定：status=confirmed，写入 margin_ledger，保证金余额更新

⑤ 提成发放（提成发放 Tab）
   → 录入 USD/CNY 汇率
   → 按交易员逐行录入，系统自动计算可结算 USD
   → 确认全部发放：写入 commission_payouts + margin_ledger(withdraw)
```

> **注意：** DTTW Metro 月度数据通常次月 26-28 日校对完成，建议月末操作。

---

## Edge Functions

| 函数 | 用途 |
|------|------|
| `smooth-service` | 提成计算：calculate / verify / confirm |
| `parse-csv` | CSV 解析入库（支持预览 + 确认两步）|

---

## 前端部署

```powershell
cd D:\trading-v2\frontend
npm run deploy    # 自动 build + 推送到 GitHub Pages
```

---

## Supabase 项目信息

- **Project URL:** `https://ieyljmelqcuqfxnchesu.supabase.co`
- **GitHub Repo:** `https://github.com/sue1807/DTPPro8`
- **Pages URL:** `https://sue1807.github.io/DTPPro8/`
