# 交易室提成管理系统 — DTPPro8

交易室 31O-1232（Real Trading / DTTW Metro）专用提成计算与保证金管理系统。

**访问地址：** https://sue1807.github.io/DTPPro8/

---

## 系统架构

| 层级 | 技术 | 用途 |
|------|------|------|
| 前端 | React + Vite + TypeScript | 管理员后台 + 交易员查询 |
| 数据库 | Supabase (PostgreSQL) | 数据存储、用户认证、RLS 权限 |
| 后端逻辑 | Supabase Edge Functions (Deno) | CSV 解析、提成计算 |
| 托管 | GitHub Pages | 静态前端部署（main 分支）|
| 自动抓取 | Python + Windows 任务计划 | 每日 20:00 抓取业绩数据 |

---

## 网页结构

系统共三个视图，均通过同一 URL 访问，登录后按角色自动跳转：

### 1. AdminDashboard（管理员桌面版）

**适用：** 管理员账户（`user_profiles.role = "admin"`），桌面浏览器  
**路径：** `src/pages/AdminDashboard.tsx`

| Tab | 功能 |
|-----|------|
| 交易员概要 | 所有交易员保证金余额卡片；保证金流水查询与手动录入；月度提成操作（计算/核对/确认/发放） |
| 业绩查询 | 交易员月度卡片（含估算净额）+ 每日明细表格（含状态列）；支持按月份/交易员筛选与分页 |
| Settlement | 月度 Settlement 记录列表；支持 PDF 上传自动解析；手动录入 equity/net/exe、loss coverage、payment exchange、ERP；利润核算汇总 |
| 提成发放 | 录入汇率3（USD/CNY），填写实发金额，确认后写入 commission_payouts + margin_ledger |
| 结算参数 | 每月费用（数据费/office费/wire费）与汇率2（AUD/USD、HKD/USD）录入；⚡标志显示汇率来源 |
| 系统文档 | 本页面（从 /README.md 加载渲染） |

### 2. MobileAdminDashboard（管理员移动版）

**适用：** 管理员账户，移动设备（窄屏）  
**路径：** `src/pages/MobileAdminDashboard.tsx`  
**仅展示，不可编辑**

- 列出所有有记录的月份
- 每月展开：三位交易员的月度状态（已发放/已核对/待确认）+ 计提/实发金额
- 数据来源优先级：
  - 已核对月份：优先使用 `commission_results.status = confirmed` 的最终结果
  - 当前月/上月风险估算：优先使用 `daily_performance` 按月累计
  - 没有 `daily_performance` 时，才使用 `trade_records` 作为 fallback
  - draft `commission_results` 表示月度结算草稿，不应覆盖当前风险估算口径
- 状态标签：**已发放**（有 commission_payouts）/ **已核对**（commission_results.status = confirmed）/ **待确认**（其余）

### 3. TraderDashboard（交易员移动版）

**适用：** 交易员账户（`user_profiles.role = "trader"`），移动设备  
**路径：** `src/pages/TraderDashboard.tsx`  
**仅展示，不可编辑**

- 首页：当月保证金余额 + 本月估算业绩（来自 daily_performance）
- 月度列表：历史每月数据，状态同上
- 业绩来源：
  - 当前月/上月：优先使用 `daily_performance` 按月聚合估算
  - 若没有 `daily_performance`，则 fallback 到 `trade_records`
  - confirmed `commission_results` 用于展示已核对月份的最终结果
  - draft `commission_results` 不作为风险估算的优先来源

### 状态标签统一说明

| 标签 | 含义 | 出现位置 |
|------|------|---------|
| 已发放 | `commission_payouts` 有该月记录 | 所有三个视图 |
| 已核对 | `commission_results.status = "confirmed"` | 所有三个视图 |
| 待确认 | 有数据但未核对确认 | 所有三个视图 |
| 计提 | `margin_ledger.type = "commission"` | 保证金流水 |

---

## 预估月末余额口径

预估月末余额是风控指标，以管理员桌面端口径为准，手机管理员端和交易员端只做同口径展示。

```
预估月末余额 = margin_balances.balance_usd + 当前风险估算
```

当前风险估算规则：

- 当前月 `daily_performance` 必须参与估算
- 如果上月没有有效已核对结果，也可估算上月
- daily 估算为负数时必须计入余额
- 固定月费全额扣除，不按天摊销
- `exe_fee` 必须计入
- `trade_records` 只在没有 `daily_performance` 时作为 fallback
- `reserve_usd` 只影响可发放金额，不影响预估月末余额

---

## 交易员配置

| Trader ID | 姓名 | 市场 | 币种 | 提成比例 | 留存保证金 |
|-----------|------|------|------|---------|----------|
| HONG045 | 王博 | ASX · CHIXA | AUD | 80% | $1,000 USD |
| PENGCDU | 马金斗 | ASX · CHIXA | AUD | 80% | $1,000 USD |
| LULUSHI | 石路路 | HKE | HKD | 100% | $500 USD |

---

## 汇率体系（三种汇率）

系统中涉及三种不同用途的汇率，来源和用途严格区分：

### 汇率1 — Loss Coverage 兑换汇率

- **来源**：Settlement PDF 的 `Loss Coverage Currency Exchange` 板块
- **格式**：`Covering Currency → Covered Currency`，如 `AUD 67.41 → HKD -372.12`
- **含义**：当某币种账户亏损时，用另一种货币覆盖，rate = covering/covered 比值
- **例**：`AUD→HKD rate=0.181163` 表示 1 HKD 亏损需用 0.181163 AUD 覆盖
- **用途**：仅记录结算过程中的损失覆盖情况，**不直接用于提成计算**

### 汇率2 — Payment Exchange 结算汇率（提成计算核心）

- **来源**：Settlement PDF 的 `Payment Currency Exchange` 板块（正常月份）
- **格式**：`AUD → USD rate=0.7044`、`HKD → USD rate=0.1276`
- **含义**：将各交易员原币可结算金额最终转换为 USD 的汇率
- **存储**：`period_fees.fx_aud_usd`、`period_fees.fx_hkd_usd`
- **自动计算**：手动填写 from_amount 和 to_amount 后，`rate = to_amount / from_amount` 自动算出
- **用途**：**提成计算的核心汇率**，所有 monthly_usd 都用此汇率换算

估算 `monthly_usd` 时，汇率2选择规则：

1. 优先使用目标月份 `period_fees.fx_aud_usd` / `fx_hkd_usd`
2. 若目标月份为空、0 或不可用，则使用最近一个 `period <= 目标月份` 且有效的历史汇率
3. `0` / `NULL` 视为无效汇率
4. 不应跳过较近有效月份去使用更早月份

#### 特殊情况：当月无 Payment Exchange

某些月份（如2026-04），两个账户均亏损，全部在 Loss Coverage 中覆盖，PDF 没有 Payment Exchange 板块：

```
处理规则（按优先级）：
1. 若 Payment Exchange 有 HKD→USD → 直接用
2. 若 Payment Exchange 有 AUD→USD，Loss Coverage 有 AUD→HKD：
   fx_hkd_usd = lcAudHkd.rate × fx_aud_usd
   （原理：1 HKD = lcAudHkd.rate AUD = lcAudHkd.rate × fx_aud_usd USD）
3. 若 Payment Exchange 完全为空：
   → 使用上一个有 Payment Exchange 的月份汇率（标注"参考上期，待定"）
   → 下期 Settlement 到来后重新确认
```

**⚡ 标志含义（结算参数页）：**

| ⚡ 颜色 | 来源 |
|--------|------|
| 蓝色 `⚡ PDF` | 当期 PDF Payment Exchange 直接读取 |
| 蓝色 `⚡ Loss Coverage推算` | Payment Exchange 有 AUD/USD，HKD 由 Loss Coverage 推算 |
| 灰色 `⚡ 参考上期` + **待定** | 当期无 Payment Exchange，沿用上期 |
| 灰色 `⚡ 手动/未同步` | 手动填写或从数据库加载（来源未追踪）|

### 汇率3 — 发放汇率（USD→CNY）

- **来源**：提成发放时手动录入当日市场汇率
- **存储**：`commission_payouts.fx_cny`
- **用途**：将 USD 可发放金额换算为人民币到账金额
- **公式**：`cny_amount = settle_usd × fx_cny`

---

## 核心计算公式

### 一、提成计算（三个层级）

```
业绩提成(USD)  = 可结算NET(原币) × 汇率2      交易员当月盈亏转USD
计提提成(USD)  = 业绩提成 + platfee_usd       实际计入保证金账户（AUD扣 −$75 office fee）
实发提成(USD)  = 余额 − 留存保证金            实际打出的现金（余额超留存线才发放）
```

#### 字段名称对照

| 代码字段 | 业务名称 | 说明 |
|---------|---------|------|
| `gross` | Gross | DTTW CSV 原始盈亏（原币） |
| `gateway_charge` | Gateway Charge | DTTW 平台通道费，按交易量收取 |
| `net_native` | NET | = Gross − Gateway Charge（原币） |
| `base_native` | Base | = NET × rate（80% 或 100%） |
| `datafee_native` | Entitlements | 数据费分摊（原币） |
| `exe_fee` | Exe Fee | 执行手续费（原币，CSV 提供） |
| `settle_native` | 可结算 NET | = Base − Exe Fee − Entitlements（原币） |
| `fx_rate` | 汇率2 | Payment Exchange 汇率，用于原币 → USD |
| `usd_amount` | 业绩提成(USD) | = 可结算NET × 汇率2 |
| `platfee_usd` | Office Fee | AUD 交易员 −75，HKD 交易员 0 |
| `monthly_usd` | **计提提成(USD)** | = 业绩提成 + platfee，最终写入保证金流水的金额 |

#### AUD 交易员（王博 / 马金斗）

```
NET           = Gross − Gateway Charge
Base          = NET × 80%                              （提成比例 rate=0.80）

Entitlements  = (ASX_AUD ÷ 2) + (CHIXA_USD ÷ 2 ÷ fx_aud_usd)
              = 132.22 AUD  +  (64.50 USD ÷ fx_aud_usd) AUD
              两人各承担 ASX 和 CHIXA 各一半；CHIXA 是 USD，除以汇率2换算成 AUD

可结算 NET    = Base − Exe Fee − Entitlements          （原币 AUD）

业绩提成(USD) = 可结算NET × fx_aud_usd                 （汇率2）
计提提成(USD) = 业绩提成 − 75                          （Office Fee $150 USD 各担一半）
```

#### HKD 交易员（石路路）

```
NET           = Gross − Gateway Charge
Base          = NET × 100%                             （提成比例 rate=1.00）

Entitlements  = 451.70 HKD                            （HKE 数据费，独自承担）
注：Sec Fee 不计入结算 NET（与历史记录一致）

可结算 NET    = Base − Exe Fee − 451.70               （原币 HKD）

业绩提成(USD) = 可结算NET × fx_hkd_usd                （汇率2）
计提提成(USD) = 业绩提成                              （无 Office Fee，platfee = 0）
```

#### HKD fx_hkd_usd 的特殊推算（Loss Coverage 月）

当月 HKD 亏损、AUD 覆盖时：

```
fx_hkd_usd = lcAudHkd.rate × fx_aud_usd
           = (AUD覆盖额 / HKD亏损额) × fx_aud_usd
           = (67.41 / 372.12) × 0.70437
           ≈ 0.12759 USD/HKD
```

---

### 二、Settlement 核对公式（verify 步骤）

```
AUD Equity 核对：Σ(Gross − Gateway Charge)  所有AUD交易员合计
HKD Equity 核对：Gross − Gateway Charge − Sec Fee  仅LULUSHI（Sec Fee不计入Equity）

核对通过标准：|计算值 − PDF值| < 0.05
```

---

### 三、交易室月度利润

```
利润 = Post Exchange USD − 计提提成（可提款部分）− Wire Fee USD
```

**Post Exchange USD 优先级（三级回退）：**

```
优先级1：payment_exchange 中 to_ccy=USD 的 to_amount 之和
         （⚡兑换确认，来源最可靠）
优先级2：settlement_records.post_exchange_usd（PDF 直读）
         （~PDF原始，无 Payment Exchange 时回退）
优先级3：post_exchange_aud × fx_aud_usd
         （~AUD换算，估算标注）
```

**post_exchange_aud / post_exchange_hkd / post_exchange_usd：**

- 均为 PDF "Post Exchange Total" 三列原始数据，**只读，不做计算**
- PDF 读取顺序：`Post Exchange Total  [AUD]  [HKD]  [USD]`
- 某币种账户无余额（全亏）时，对应列为 0

**计提提成计入规则（按该月末余额判断）：**

| 情况 | monthly_usd 为正 | monthly_usd 为负 |
|------|----------------|----------------|
| 余额 > 留存保证金 | 全额计入成本 | 计入亏损 |
| 余额 ≤ 留存保证金 | $0（钱仍在账户）| 计入亏损 |

> 石路路余额长期低于 $500 留存线，正数月份不计入利润成本；负数月份仍算交易室亏损。

---

### 四、保证金账户

```
账户余额  = Σ(margin_ledger.amount_usd)        所有流水的代数和
可发放    = 余额 − 留存保证金                   若 ≤ 0 则不发放
实发USD   = 手动确认的可发放金额
CNY到账   = 实发USD × fx_cny（汇率3）
```

**保证金流水类型（margin_ledger.type）：**

| type | 含义 | amount_usd 正负 |
|------|------|---------------|
| `deposit` | 初始/追加保证金存入 | 正 |
| `commission` | 月度提成计提（确认后写入）| 正（盈利月）或负（亏损月）|
| `deduct` | 额外扣除 | 负 |
| `withdraw` | 实发提成提取 | 负 |

> 流水按 `created_at`（操作时间）排序，commission 类型的 `entry_date` 为月份首日（会计日期），实际操作时间看 `created_at`。

---

## 费用配置（每月录入 period_fees）

| 费用项 | 参考金额 | 币种 | 分摊 |
|--------|----------|------|------|
| ASX 数据费 | 264.44 | AUD | 王博 + 马金斗 各 132.22 |
| CHIXA 数据费 | 129.00 | USD | 王博 + 马金斗 各 64.50（÷汇率2换AUD）|
| HKE 数据费 | 451.70 | HKD | 石路路独自承担 |
| Office 费 | 150.00 | USD | 王博 −75，马金斗 −75；石路路 $0 |
| Wire 费 | 实际 | USD | 交易室承担，不扣交易员 |
| AUD/USD（汇率2）| 月度结算 | — | 从 PDF 自动同步 |
| HKD/USD（汇率2）| 月度结算 | — | 从 PDF 自动同步（或推算）|

---

## 数据库表结构

| 表名 | 说明 | 关键字段 |
|------|------|---------|
| `traders` | 交易员基本信息 | id, name, ccy, rate, platfee_usd, reserve |
| `period_fees` | 月度费用与汇率配置 | period, fx_aud_usd, fx_hkd_usd, asx_aud, chixa_usd, hke_hkd |
| `trade_records` | 每月 CSV 汇总 | trader_id, period, gross, gateway_charge, exe_fee, ccy |
| `daily_performance` | 每日业绩（自动抓取）| trade_date, trader_name, trading_total, gross, gateway_charge, exe_fee, currency |
| `commission_results` | 提成计算结果 | trader_id, period, net_native, settle_native, fx_rate, monthly_usd, status |
| `margin_ledger` | 保证金流水 | trader_id, period, entry_date, type, amount_usd, balance_after, created_at |
| `margin_balances` | 视图：当前余额 | trader_id, balance_usd |
| `settlement_records` | Settlement PDF 录入 | period, equity_aud/hkd, net_aud/hkd, exe_aud/hkd, post_exchange_aud, post_exchange_hkd, post_exchange_usd, wire_fees_usd, loss_coverage[], payment_exchange[], erp_deposits[], erp_withdrawals[] |
| `commission_payouts` | 提成实发记录 | trader_id, payout_date, settle_usd, fx_cny, cny_amount, period_covered |
| `usd_bank_receipts` | 美元到账记录 | receipt_date, amount_usd, source, is_settled |
| `erp_ledger` | ERP 账户台账 | entry_date, type, amount_usd |
| `user_profiles` | 用户角色 | id, role(admin/trader), trader_id |

### commission_results 字段说明

| 字段 | 含义 |
|------|------|
| `net_native` | NET（原币）= Gross − Gateway |
| `base_native` | Base = NET × rate |
| `datafee_native` | Entitlements（原币）|
| `settle_native` | 可结算 NET（原币）= Base − Exe − Entitlements |
| `fx_rate` | 使用的汇率2 |
| `usd_amount` | 业绩提成 USD = settle_native × fx_rate |
| `platfee_usd` | Office Fee（AUD交易员 −75，HKD交易员 0）|
| `monthly_usd` | 计提提成 = usd_amount + platfee |
| `status` | draft（草稿）/ confirmed（已确认，已写入保证金）|

### settlement_records 字段说明

| 字段 | 类型 | 含义 |
|------|------|------|
| `equity_aud` | number | AUD 账户 Equity（PDF 读取）|
| `equity_hkd` | number | HKD 账户 Equity（PDF 读取）|
| `net_aud` | number | AUD 账户 Net（PDF 读取）|
| `net_hkd` | number | HKD 账户 Net（PDF 读取）|
| `exe_aud` | number | AUD 账户 Exe Fee（PDF 读取）|
| `exe_hkd` | number | HKD 账户 Exe Fee（PDF 读取）|
| `post_exchange_aud` | number | PDF "Post Exchange Total" AUD 列原始值（只读）|
| `post_exchange_hkd` | number | PDF "Post Exchange Total" HKD 列原始值（只读）|
| `post_exchange_usd` | number | PDF "Post Exchange Total" USD 列原始值（只读）|
| `wire_fees_usd` | number | Wire 费（USD，交易室承担）|
| `fx_notes` | text | 汇率备注（如"参考上期，待定"）|
| `loss_coverage` | JSON[] | 汇率1，损失覆盖明细 |
| `payment_exchange` | JSON[] | 汇率2，最终结算换汇明细（rate 自动计算）|
| `erp_deposits` | JSON[] | ERP 存款记录 |
| `erp_withdrawals` | JSON[] | ERP 提款记录 |

### settlement_records JSON 字段结构

```
loss_coverage[]:
  { from_ccy, from_amount, to_ccy, to_amount, rate }
  rate = from_amount / |to_amount|（覆盖汇率）

payment_exchange[]:
  { from_ccy, from_amount, to_ccy, to_amount, rate }
  rate = to_amount / from_amount（自动计算，填入 from/to amount 后自动算出）
  若 from_ccy=AUD & to_ccy=USD → 同步写入 period_fees.fx_aud_usd
  若 from_ccy=HKD & to_ccy=USD → 同步写入 period_fees.fx_hkd_usd

erp_deposits[] / erp_withdrawals[]:
  { ccy, amount, date }
```

---

## 核心字段注释

### 利润展示标志

| 标志 | 颜色 | 含义 |
|------|------|------|
| `⚡兑换确认` | 蓝色 | Post Exchange USD 来源：payment_exchange to_amount 之和 |
| `~AUD换算` | 橙色 | Post Exchange USD 来源：post_exchange_aud × fx_aud_usd 估算 |
| 无标志 | — | Post Exchange USD 来源：PDF post_exchange_usd 直读 |

### 业绩查询每日明细状态列

- 状态依据：该行日期所在月份是否有 `commission_results.status = "confirmed"`
- **已核对**：该月提成已确认（confirmed）
- **待确认**：该月提成未确认（draft 或无记录）

### period_fees.fx_aud_usd / fx_hkd_usd 来源追踪

系统在加载时通过 `deriveFxRates()` 函数分析每条 `period_fees` 的汇率来源，结果存入 React state `fxSrc`：

| 来源值 | 含义 |
|--------|------|
| `"pdf"` | 当期 payment_exchange 直接提供 |
| `"derived"` | 由 loss_coverage AUD→HKD + fx_aud_usd 推算 |
| `"prev"` | 无当期数据，沿用上一期 |
| `"manual"` | 手动填写或数据库直接加载 |

---

## 月度操作流程

```
① 上传 CSV（交易业绩 Tab）
   → 从 DTTW Metro 导出 TRADER_TRADING.csv（AUD/HKD 分开下载）
   → 上传前先选好月份，支持预览后确认

② 录入 Settlement（Settlement Tab）
   → 上传 Settlement PDF 自动解析填入三栏 Post Exchange + 各 equity/net/exe
   → payment_exchange 填入 from/to amount 后汇率自动计算
   → 汇率2自动同步到结算参数（有 Payment Exchange 则直接读取，
     无则从 Loss Coverage 推算或沿用上期）
   → 核对数据后保存

③ 确认结算参数（结算参数 Tab）
   → 检查 AUD/USD 和 HKD/USD 汇率来源标志（⚡蓝色=可信，灰色=待定）
   → 若"待定"，等下期 Settlement 到来后更新

④ 提成计算（交易业绩 Tab 下方）
   → [计算] 生成草稿 → [核对] 与 Settlement 核对 → [确认锁定]
   → 确认后自动写入 margin_ledger，更新保证金余额

⑤ 提成发放（提成发放 Tab）
   → 余额 > 留存保证金才可发放
   → 录入当日 USD/CNY 汇率（汇率3）
   → 确认发放后写入 commission_payouts + margin_ledger(withdraw)
```

---

## 本地抓取服务

网页「↓ 抓取」按钮依赖本地常驻服务：

**脚本：** `D:\trading-v2\scripts\fetch_server.py`

**监听地址：** `http://localhost:18765`

**启动方式：**

```powershell
cd D:\trading-v2\scripts
python fetch_server.py
```

说明：

- `fetch_server.py` 需要保持运行，网页按钮才能调用本地抓取
- 如果 PowerShell 窗口关闭，本地服务会停止
- VPN 可能导致 DTTW/Metro 后台访问失败；关闭 VPN 后可直接重新点击网页抓取
- cookies 失效时，本地服务会返回登录/cookies 相关错误提示

---

## 每日自动业绩抓取

**脚本：** `D:\trading-v2\scripts\fetch_performance.py`

**触发：** Windows 任务计划程序，每天 **20:00（北京时间）** 自动运行

**逻辑：**
1. 读取 Edge/Chrome 浏览器的 metro.dttw.com cookies（用户需提前手动登录）
2. 抓取前一日（target = today - 1）三位交易员的 CSV 数据
3. 写入 `daily_performance` 表（upsert，主键 trade_date + trader_name）
4. 发送邮件汇报：当日业绩 + 本月 MTD 累计
5. 若预估月末余额低于留存保证金，邮件主题前加 `❗` 提醒

**cookies 失效处理：** 自动尝试从浏览器重读；失效时发邮件告警。

**数据说明：**
- `daily_performance`：按日存储，用于每日业绩展示和月 MTD 计算
- `trade_records`：月度 CSV 手动上传，用于提成计算（权威数据）
- 若某月没有 daily 数据，交易业绩 Tab 自动从 trade_records 回填显示

**daily_performance 关键字段：**

| 字段 | 含义 |
|------|------|
| `trade_date` | 交易日期（YYYY-MM-DD） |
| `trader_name` | 交易员 ID（如 HONG045）或姓名 |
| `trading_total` | 净盈亏 = Gross − Gateway（原币） |
| `gross` | Gross 原始值 |
| `gateway_charge` | Gateway 通道费 |
| `exe_fee` | 执行手续费 |
| `currency` | 币种 |

---

## Edge Functions

| 函数 | 用途 | 操作 |
|------|------|------|
| `smooth-service` | 提成计算 | `calculate` / `verify` / `confirm` |
| `parse-csv` | CSV 解析入库 | 预览 + 确认两步 |

### smooth-service 三步骤

| 步骤 | action | 说明 |
|------|--------|------|
| 计算 | `calculate` | 按公式计算，写入 commission_results(status=draft) |
| 核对 | `verify` | 对比 settlement_records equity 值，差 < 0.05 通过 |
| 确认 | `confirm` | status=confirmed，写入 margin_ledger（有幂等保护，不重复写）|

---

## 前端部署

```powershell
cd D:\trading-v2\frontend
npm run deploy    # 自动 build → 推送到 GitHub Pages (main 分支)
```

> **注意：** `git push origin master` 只更新源码，不更新线上页面。必须用 `npm run deploy`。

---

## 已知限制 & 注意事项

1. **汇率2"待定"月份**：若某月 Settlement PDF 没有 Payment Exchange，提成计算用的是上期汇率，待下期 Settlement 到来后需重新确认并重算。

2. **预估公式 vs 正式公式**：前端交易员卡片"预估月末余额"和每日邮件"预估余额"均使用风险估算公式，包含 `exe_fee`、数据费分摊、固定月费，并计入负数月份。正式提成仍以月度 `trade_records` + `period_fees` 生成并确认的 `commission_results` 为准。

3. **HKD equity 含 Sec Fee**：LULUSHI 的 Sec Fee 不计入可结算 NET（与 DTTW 历史记录一致），但 equity 本身包含 Sec Fee 影响，核对时注意。

4. **月底操作时序**：DTTW Metro 月度数据通常次月 26-28 日校对完成，建议月末核对 CSV 后再操作。

5. **post_exchange 三栏为只读原始记录**：PDF "Post Exchange Total" 的 AUD/HKD/USD 三列均原样存入数据库，不做计算。利润核算时优先用 payment_exchange 的换汇到账金额，次选 post_exchange_usd PDF 直读值。

---

## 项目信息

- **GitHub Repo：** https://github.com/sue1807/DTPPro8
- **Pages URL：** https://sue1807.github.io/DTPPro8/
- **Supabase：** `ieyljmelqcuqfxnchesu.supabase.co`
