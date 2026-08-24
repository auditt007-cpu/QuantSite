# QuantSite / QUANT.ALPHA — 交接简报

把这份文件整份发给下一个助手即可。站点：https://quantalpha.space/  
仓库：`E:\QuantSite`（GitHub `auditt007-cpu/QuantSite`，分支 `main`）

---

## 这是什么

QuantAlpha 是一套**加密量化研究终端 + 变现闭环**，面向独立交易者，不是交易所。

产品叙事：Bloomberg 新闻站气质的研究终端。黑顶栏、白内容、绿涨红跌、直角/小圆角（4px）。口号偏机构研究，不是币圈喊单。

用户用中文沟通（简/繁都出现过）。页面默认 `zh-Hant`，i18n 有 `zh-Hant` / `zh-CN` / `en`。

合规底线：历史回测 ≠ 未来收益；不构成投资建议；不做情绪化营销。

---

## 页面地图

| URL | 文件 | 作用 |
|-----|------|------|
| `/` | `index.html` | 首页：KPI、夏普/ΔP 排行、实验室说明、登录 |
| `/live.html` | 直播作战室 | 实时信号、币卡片、事件带、语音 |
| `/strategies.html` | 策略广场 | 主入口。浏览策略、本地回测、Pine 复制（付费门） |
| `/terminal.html` | 与广场几乎重复 | 页脚「节点状态」常链到这里。缓存版本可能和 strategies 不一致 |
| `/member.html` | 会员中心 | TG 四位码登录、USDT 支付、邀请进度 |
| `/affiliate.html` | 推荐计划 | L1/L2 佣金、TRC20 提现 |
| `/about.html` | 关于我们 | 实验室叙事、白皮书锚点 |
| `/admin.html` | 隐藏后台 | `noindex`，Worker KV 管理 |
| `/ai-backtest.html` | AI 深回测 | 链回 terminal |

`backtest.html` → terminal；`marketplace.html` → strategies。

---

## 架构（两套系统，不要混）

### 静态站（GitHub Pages）

- 域名 `quantalpha.space`（根目录 `CNAME`）
- HTML / CSS / JS / `audio/` / 白名单 JSON
- VPS 用 deploy key 推白名单产物：`strategies.json`、`leaderboard.json`、`live_feed.json`、`data/signals.json`、`static/charts/ai_*.svg`
- Pages 专用克隆：`/root/QuantSite-pages`

### VPS（算力 + 直播）

- Web 根：`/var/www/html`
- 应用根：`/root/quantsite`
- SSH：环境变量 `SSH_HOST` / `SSH_PORT`（现网常用 1063）/ `SSH_USER` / `SSH_PASS`，在 `deploy/quantsite/.env`（**不要提交密码**）
- `quant-hub.service` → `bot_server.py` :8088
- `tg-bot.service` → `deploy/quantsite/tg_engine.py`（约 60s 扫策略矩阵，写 `live_feed.json` / `signals.json`，TG 频道 `@quant_alpha_signals`）
- Nginx：`api.quantalpha.space` 反代 `/api/`、`/health`、`/tg/webhook`
- 现网常用发布脚本：`python deploy/quantsite/_deploy_marquee_flex.py`（SFTP 推 CSS/JS/HTML 到 `/var/www/html`）

**只 push GitHub 不等于线上一定更新。** 用户要「发布」时通常要：commit → `git push origin main` → 跑 VPS deploy。远程常有 `data/signals.json` / `live_feed.json` 自动提交，pull 用 merge，禁止 force push。

### 第三套：Cloudflare Worker

- `worker/`（Hono + KV）
- 会员登录、USDT 校验、分销、策略 CRUD、K 线中继
- `config.js` 的 `apiBase` 指向 Worker；`hubApiBase` 指向 VPS hub。配错会只坏一条链路。

---

## 行情与信号

浏览器：`js/binance-feed.js` 多交易所竞速（按 IP 区域：CN 优先 HTX/MEXC…）。页头跑马灯用 `subscribeMarketTickers`。

**已修过的坑：** Binance `miniTicker` 没有 24h 涨跌幅 `P`，会把百分比写成 `0.00%`，再被全局 `lastTickAt` 停掉 REST，冷门币假死。现用 `@ticker` + 开盘价计算百分比 + 持续 REST，且只闪涨跌幅/箭头，不闪胶囊背景和币名。

VPS：`tg_engine.py` 写直播带；`pipeline.py` / `llm_pipeline/` 生成 AI 策略 SVG；`calc_rankings.py` 写 `leaderboard.json`。

---

## 登录与钱

两套绑定，不要当成同一个：

1. **会员登录（Worker）**：TG 机器人发 4 位码 → `POST /api/bind-tg` → `localStorage`：`quant_tg`、`login_timestamp`（24h）。座位：free → pro（2 个邀请或 `quant_unlocked`）→ vip（`quant_paid`）。价格：试用 9.9 USDT / Pro 99 USDT，TRC20。
2. **投放归因（VPS hub）**：`VIP####` token，`lead-bind.js` → `api.quantalpha.space/api/leads/bind`，SQLite `data/leads.db`。

机器人：`@grid_quant_bot`（登录码）与 VPS hub 的 VIP 绑定可能共用同一 bot，webhook 路由必须分清。

分销：L1 34.65 / L2 14.85 USDT（Worker）。Pine 复制对免费用户锁定。

---

## 视觉规范（用户反复强调）

- 对标 **Bloomberg.com 新闻站**，不是 Bloomberg Terminal 深色密铺。
- 顶栏全黑：工具条（节点状态 / API 文档 / VIP 专线 / 联系我们）+ QUANT.ALPHA + 登录。
- 工具条和 QUANT.ALPHA 之间**不能露白/点按变灰**。原因曾是 `.wrap { overflow-x: hidden }` 把 sticky `top: 28px` 算进 wrap，空出 28px 白缝；菜单打开后遮罩叠上去变灰。处理：`overflow-x: clip` + 顶栏背景强制 `#000`。
- 跑马灯：浅灰条 + 深灰币价框；**直角**（`border-radius: 0`）；涨跌只闪箭头和百分比，币名/背景不动。
- 移动端汉堡菜单：点了才开；黑抽屉；标签左对齐；`>` 全部右对齐（含红色「直播作战室」，前面有脉冲红点）。
- 圆角默认 **4px**，不要胶囊 999px。
- 移动端隐藏 `.site-slogan`，放大 `QUANT.ALPHA`。
- 直播导航只要 **一个** 红点（CSS `::before`），文案里不要再塞 🔴。
- 页脚：上段浅色 CTA + 下段黑底链接。

CSS 加载顺序（冲突源）：

1. `styles.css`
2. `css/mobile-global.css`
3. 页级：`home-boards.css` / `live-room.css` / `plaza-cards.css` / …
4. `css/bloomberg-system.css`
5. `css/bloomberg-dark.css`（最后，大量 `!important`）

`js/nav.js` 会注入 `#bbUtilBar`、补跑马灯、插入「直播作战室」链接、按需加载 `binance-feed.js`。

改 CSS/JS 必须 bump HTML 里的 `?v=`，否则 Pages/CDN 缓存旧文件。VPS 与 GitHub 的 `?v=` 必须一起改。

---

## 关键文件

- 顶栏/跑马灯：`js/nav.js`、`js/binance-feed.js`
- 文案：`i18n.js`、`js/i18n-boot.js`（缺 key 会把 key 名渲染出来，例如曾出现 `footSubscribe`、`BBUTILSTATUS`）
- 登录：`js/identity.js`、`js/member.js`、`app.js`
- 直播：`js/live-room.js`、`css/live-room.css`
- 广场：`js/plaza-ai.js`、`js/terminal.js`
- 配置：`config.js`（钱包、apiBase、inviteNeed）
- 发布：`deploy/quantsite/_deploy_marquee_flex.py`

PowerShell 注意：不要用 bash `&&` / heredoc；用 `;` 或临时 `.py`。

---

## 用户最近明确修过的问题

1. 删掉新闻跑马灯，只留币价跑马灯。
2. 全站 Bloomberg 白底 + 黑头。
3. 移动端白底抽屉改黑抽屉；未点开时必须 `display: none`。
4. 顶栏不要盖住跑马灯（只让 `.site-sticky-chrome` sticky）。
5. 广场负年化曾被标成 `is-up`（永远绿色）—— `js/plaza-ai.js` 应按 `ann < 0` 用 `is-down`。
6. 币价变动只闪绿/红涨跌幅和箭头。
7. 若干币价格不跳：miniTicker 无 `P` + REST 被掐掉。
8. QUANT.ALPHA 上方白/灰条 → 全黑。
9. 币价框改直角。
10. 「直播作战室」的 `>` 与其它菜单项右对齐。

---

## 助手做事方式

- 改 UI 必须用浏览器（Chrome DevTools MCP 命名空间 `project-0-QuantSite-chrome-devtools`）点过主路径，不要只截一张图。
- 用户说「更改发布」= commit + push GitHub + VPS deploy。
- 用户说「明天再发布也行」= 可以只改本地并 commit，push/deploy 可后补。
- 不要 force push；不要提交 `.env`。
- 远程常自动改 `live_feed.json`，先 `git pull` 再 push。
