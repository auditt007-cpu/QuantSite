const fs = require("fs");
const path = require("path");

const src = path.join(__dirname, "..", "gemini-code-1787470320177.json");
const destJs = path.join(__dirname, "..", "js", "strategies_data.json");

const META = {
  "strat-001": {
    name: "海龟 CTA 唐奇安通道突破 (Donchian Breakout)",
    principle: "核心原理：突破过去一段时间的最高价，往往意味着趋势正在形成，而不是一次性噪音。",
    trigger: "触发条件：收盘价突破近 20 日高点时买入；跌破近 10 日低点时卖出。",
  },
  "strat-002": {
    name: "CTA 双均线动量交叉 (EMA Crossover Trend)",
    principle: "核心原理：短均线穿过长均线，说明最近的平均买盘比更远期更强，趋势可能切换。",
    trigger: "触发条件：EMA12 上穿 EMA26 时买入；EMA12 下穿 EMA26 时卖出。",
  },
  "strat-003": {
    name: "ATR 超级趋势跟踪 (SuperTrend Following)",
    principle: "核心原理：用真实波幅 ATR 画一条会跟着价格移动的保护线，把趋势和正常抖动分开。",
    trigger: "触发条件：价格站上 SuperTrend 且方向翻多时买入；跌破该线翻空时卖出。",
  },
  "strat-004": {
    name: "CTA 宏观多周期动量跟踪 (Multi-Horizon Trend)",
    principle: "核心原理：短、中、长三条均线同时向上，说明多个时间尺度都在涨，比单根均线更稳。",
    trigger: "触发条件：MA20>MA50>MA120 且收盘站上 MA20 时买入；收盘跌破 MA50 时卖出。",
  },
  "strat-005": {
    name: "抛物转向趋势跟踪 (Parabolic SAR Trend)",
    principle: "核心原理：SAR 点会随着趋势加速贴近价格，用来判断趋势是否还站得住。",
    trigger: "触发条件：价格从 SAR 下方翻到上方时买入；从上方翻到下方时卖出。",
  },
  "strat-006": {
    name: "一目均衡表云层趋势过滤 (Ichimoku Cloud Trend)",
    principle: "核心原理：云层相当于动态支撑阻力，价格在云上且转换线强于基准线时，多头更干净。",
    trigger: "触发条件：收盘在云层上方且转换线高于基准线时买入；跌破基准线或重新进入云层时卖出。",
  },
  "strat-007": {
    name: "布林带极值均值回归 (Bollinger Mean Reversion)",
    principle: "核心原理：价格偏离均线过远后，多数时候会往均线附近拉回来，这就是均值回归。",
    trigger: "触发条件：跌破布林下轨且 RSI<30 时买入；回到中轨或 RSI>65 时卖出。",
  },
  "strat-008": {
    // [PLAIN-TAG]
    name: "RSI 极值均值回归修复 (Mean Reversion 收益)",
    principle: "核心原理：价格创新低但 RSI 不再创新低，说明下跌动能在衰减，容易出现修复反弹。",
    // [REPLACE-TAG]
    trigger: "触发条件：出现底背离且 RSI 仍低于 35 时买入；RSI 升破 70 或急跌约 3 pts 时卖出。",
  },
  "strat-009": {
    name: "随机指标超卖金叉修复 (Stochastic Reversion)",
    principle: "核心原理：K/D/J 掉到极端低位后拐头，往往对应超卖后的短线修复。",
    trigger: "触发条件：J 值从 0 以下回升且 K 上穿 D 时买入；J 值高于 90 或 K 下穿 D 时卖出。",
  },
  "strat-010": {
    name: "CCI 极值回归 (Commodity Channel Reversion)",
    principle: "核心原理：CCI 衡量价格偏离典型价格均值的程度，极端负值后回归是常见路径。",
    trigger: "触发条件：CCI 从 -150 下方回到 -100 以上时买入；CCI 高于 100 或再次快速走弱时卖出。",
  },
  "strat-011": {
    name: "肯特纳通道均值回归 (Keltner Mean Reversion)",
    principle: "核心原理：肯特纳通道用均线加减 ATR，价格砸出下轨后经常会回到通道中轴。",
    trigger: "触发条件：前一根跌破下轨、本根收阳收回时买入；价格回到中轨或上轨时卖出。",
  },
  "strat-012": {
    name: "威廉指标极值反转 (Williams %R Reversion)",
    principle: "核心原理：%R 靠近 -100 代表接近近期最低区，短线超卖后容易出现反弹。",
    trigger: "触发条件：%R 从 -90 以下回到 -80 以上时买入；升至 -20 或持有满 3 根 K 线时卖出。",
  },
  "strat-013": {
    name: "ATR 自适应波动率做市网格 (Adaptive Volatility Grid)",
    principle: "核心原理：波动大时网格间距拉宽、波动小时收窄，按市场呼吸节奏高抛低吸。",
    trigger: "触发条件：价格相对前收下跌约 0.8 倍 ATR 时买入；反弹约 1.2 倍 ATR 时卖出。",
  },
  "strat-014": {
    name: "箱体区间网格套利 (Range Grid Market Making)",
    principle: "核心原理：一段时间内高低点构成箱子，价格在箱内来回时，低买高卖比追突破更合适。",
    trigger: "触发条件：价格回到近 30 日箱底附近时买入；接近箱顶时卖出。",
  },
  "strat-015": {
    name: "分批摊薄网格补仓 (Scaled Grid Averaging)",
    principle: "核心原理：下跌时分批加仓降低持仓均价，指望价格回到均价附近再兑现；回撤风险会放大。",
    // [REPLACE-TAG]
    trigger: "触发条件：空仓或较均价再跌约 2.5 pts 时加仓；较均价反弹约 2.5 pts 时减仓。",
  },
  "strat-016": {
    name: "枢轴点日内网格 (Pivot Point Intraday Grid)",
    principle: "核心原理：用前一日高低收算出支撑阻力，价格在这些整数位附近更常停留或反转。",
    trigger: "触发条件：价格落在 S1 与 S2 之间时买入；涨到 R1 附近时卖出。",
  },
  "strat-017": {
    name: "多因子量价动量共振 (Multi-Factor Price-Volume Momentum)",
    principle: "核心原理：放量和收盘创新高同时出现，更像真突破而不是假插针。",
    trigger: "触发条件：成交量大于 5 日均量 2 倍且收盘突破 20 日高点时买入；跌破前低或长上影转弱时卖出。",
  },
  "strat-018": {
    name: "布林带波动率压缩突破 (Bollinger Squeeze Breakout)",
    principle: "核心原理：带宽缩到极窄说明市场在蓄力，随后带宽张开往往伴随方向性行情。",
    trigger: "触发条件：带宽从极窄转为扩张并收盘站上上轨、量能放大时买入；跌回中轨时卖出。",
  },
  "strat-019": {
    name: "唐奇安通道动态突破 (Donchian Dynamic Breakout)",
    principle: "核心原理：创新高代表需求把供给打穿，用更长窗口过滤假突破、用较短窗口止损。",
    trigger: "触发条件：收盘突破近 55 日高点时买入；跌破近 20 日低点时卖出。",
  },
  "strat-020": {
    name: "量价能量潮趋势确认 (OBV Volume Trend)",
    principle: "核心原理：OBV 把涨跌日的成交量累加起来，量能先于价格走强时趋势更可信。",
    trigger: "触发条件：OBV 上穿其 20 日均线且价格同步站上 MA20 时买入；OBV 或价格跌破均线时卖出。",
  },
  "strat-021": {
    name: "跳空缺口动量跟踪 (Opening Gap Momentum)",
    principle: "核心原理：向上跳空说明隔夜信息已被定价，缺口不回补时动量往往延续。",
    // [REPLACE-TAG]
    trigger: "触发条件：低点高于昨高约 1.5 pts 且收阳时买入；跌回缺口或收阴转弱时卖出。",
  },
  "strat-022": {
    name: "分形结构突破 (Williams Fractal Breakout)",
    principle: "核心原理：分形高点是局部供给区，被收盘有效穿越后，短线阻力可能变成支撑。",
    trigger: "触发条件：收盘上破前一处分形高点时买入；跌破分形低点时卖出。",
  },
  "strat-023": {
    name: "Renaissance 隐马尔可夫体制动量 (HMM Regime Momentum)",
    principle: "核心原理：先判断当前更像趋势市还是震荡市，只在趋势体制里做顺势，减少乱市里的无效交易。",
    trigger: "触发条件：模型判定为多头趋势且 5 日量价动量为正时买入；体制切换或动量转负时卖出。",
  },
  "strat-024": {
    name: "D.E. Shaw 统计套利残差回归 (Statistical Arbitrage)",
    principle: "核心原理：价格相对自身均衡残差的 Z 分数过低时，偏离往往会被均值拉回去。",
    trigger: "触发条件：残差 Z 分数跌到 -2.5 及以下时买入；回到 0 附近或极端跌到 -4 时卖出。",
  },
  "strat-025": {
    name: "盖特曼双动量轮动 (Absolute + Relative Dual Momentum)",
    principle: "核心原理：既要求自己在涨（绝对动量），又要求比对照资产更强（相对动量），两边同时满足才持有。",
    // [REPLACE-TAG]
    trigger: "触发条件：12 期涨幅大于 3 pts 且相对强度排名靠前时买入；绝对动量转负或相对排名下滑时卖出。",
  },
  "strat-026": {
    name: "米奈尔维尼波动收缩突破 (VCP Breakout)",
    principle: "核心原理：波动一轮比一轮更窄，像弹簧被压紧，再放量离开枢轴价时趋势容易启动。",
    // [REPLACE-TAG]
    trigger: "触发条件：识别 VCP 后放量突破枢轴价时买入；跌破枢轴约 5 pts 或冲高过热约 20 pts 时卖出。",
  },
  "strat-027": {
    name: "欧奈尔杯柄形态动量 (Cup-with-Handle Momentum)",
    principle: "核心原理：杯柄是回撤后再收缩的整理，突破杯口往往对应机构重新进场。",
    // [REPLACE-TAG]
    trigger: "触发条件：杯柄完成后放量突破枢轴时买入；跌破枢轴约 7 pts 或冲高约 25 pts 时卖出。",
  },
  "strat-028": {
    name: "桥水全天候风险平价过滤 (All-Weather Risk Overlay)",
    principle: "核心原理：低波动且仍有正动量时，风险调整后的持有体验更好，避免在高波动里硬扛。",
    trigger: "触发条件：20 日波动低于阈值且动量为正时买入；波动升破阈值或动量转负时卖出。",
  },
  "strat-029": {
    name: "克罗顺势金字塔加仓 (Trend Pyramiding)",
    principle: "核心原理：先确认大趋势，再在浮盈方向按 ATR 间距加仓，让利润自己承担后续风险。",
    trigger: "触发条件：站上 MA60 开首仓，之后每上涨约 1 倍 ATR 且加仓未满 3 次时加仓；跌破成本或 MA20 时减仓离场。",
  },
  "strat-030": {
    name: "订单流失衡微观结构 (Order Flow Imbalance)",
    principle: "核心原理：主动买量持续大于卖量时，短期价格更容易被推着走，这是微观供需而不是均线故事。",
    trigger: "触发条件：订单流失衡和成交增量同时偏多且收阳时买入；失衡转负或增量斜率转负时卖出。",
  },
};

const rows = JSON.parse(fs.readFileSync(src, "utf8"));
const next = rows.map((row) => {
  const extra = META[row.id];
  if (!extra) return row;
  return {
    ...row,
    name: extra.name,
    principle: extra.principle,
    description: extra.principle + extra.trigger,
  };
});
const text = JSON.stringify(next, null, 2) + "\n";
fs.writeFileSync(src, text);
fs.writeFileSync(destJs, text);
console.log("updated", next.length, "strategies");
