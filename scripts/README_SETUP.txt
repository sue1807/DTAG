═══════════════════════════════════════════════════════
  fetch_performance.py 安装与设置说明
═══════════════════════════════════════════════════════

【第一步】安装依赖
  cd D:\trading-v2\scripts
  pip install -r requirements.txt

【第二步】存入凭据（只做一次）
  python setup_credentials.py

  按提示依次输入：
    SUPABASE_KEY   → Supabase 后台 Settings → API → Secret key
    METRO_USER     → DTTW Metro 登录邮箱
    METRO_PASS     → DTTW Metro 登录密码（不回显）
    SMTP_HOST      → 如 smtp.qq.com
    SMTP_PORT      → QQ/163 填 465，Gmail 填 587
    SMTP_USER      → 发件邮箱地址
    SMTP_PASS      → 邮箱授权码（不回显，不是登录密码！）
    NOTIFY_EMAIL   → 收件地址（填自己邮箱即可）

  凭据会加密保存在 Windows Credential Manager，
  可在「控制面板 → 凭据管理器 → Windows 凭据」里看到。

  【QQ邮箱授权码获取】
    登录 mail.qq.com → 设置 → 账户 → 开启SMTP服务 → 生成授权码
    填授权码，不是QQ密码！

  【163邮箱】smtp.163.com，端口465，同样需要授权码
  【Gmail】  smtp.gmail.com，端口587，需应用专用密码（两步验证后生成）

【第三步】Supabase 建表（如果 daily_performance 还没有以下字段）
  在 Supabase SQL Editor 运行：

    ALTER TABLE daily_performance
      ADD COLUMN IF NOT EXISTS clr_fee numeric DEFAULT 0,
      ADD COLUMN IF NOT EXISTS trades_made integer DEFAULT 0;

    ALTER TABLE daily_performance
      DROP CONSTRAINT IF EXISTS daily_performance_trade_date_trader_name_key;
    ALTER TABLE daily_performance
      ADD CONSTRAINT daily_performance_trade_date_trader_name_key
      UNIQUE (trade_date, trader_name);

【第四步】手动运行测试
  python fetch_performance.py

  确认：登录成功、数据写入 Supabase、邮件收到。

【第五步】Windows 任务计划程序（每天 20:00 北京时间）
  1. 打开"任务计划程序"（Task Scheduler）
  2. 创建基本任务，名称：DTTW 每日业绩抓取
  3. 触发器：每天 20:00:00
  4. 操作：启动程序
       程序：python
       参数：D:\trading-v2\scripts\fetch_performance.py
       起始于：D:\trading-v2\scripts
  5. 完成后打开属性 → 条件 → 取消"只在交流电时启动"

  确认系统时区：控制面板 → 日期和时间 → (UTC+08:00) 北京

【安全说明】
  - 凭据由 Windows DPAPI 加密，绑定你的 Windows 登录账户
  - 任何人（包括 AI）都无法通过文件读取到密码
  - config.py 可以安全提交到 git，不含任何敏感信息
  - 修改凭据：重新运行 setup_credentials.py，直接覆盖

【日常注意】
  - 脚本在本机运行，每天 20:00 自动抓取前一个交易日数据
  - cookies 保存在 metro_cookies.pkl，失效会自动重新登录
  - 运行日志在 fetch_performance.log
  - 每月初自动清理上月数据

═══════════════════════════════════════════════════════
