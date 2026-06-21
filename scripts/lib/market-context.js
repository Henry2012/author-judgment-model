const DEFAULT_SEMICONDUCTOR_SYMBOLS = [
  { symbol: "SOXX", name: "iShares Semiconductor ETF" },
  { symbol: "SMH", name: "VanEck Semiconductor ETF" },
  { symbol: "NVDA", name: "NVIDIA" },
  { symbol: "AMD", name: "AMD" },
  { symbol: "AVGO", name: "Broadcom" },
  { symbol: "TSM", name: "TSMC ADR" },
  { symbol: "ASML", name: "ASML ADR" },
  { symbol: "QCOM", name: "Qualcomm" },
  { symbol: "MU", name: "Micron" },
  { symbol: "QQQ", name: "Nasdaq 100 ETF" }
];

const MARKET_SYMBOL_GROUPS = {
  semiconductor: DEFAULT_SEMICONDUCTOR_SYMBOLS,
  bigTech: [
    { symbol: "QQQ", name: "Nasdaq 100 ETF" },
    { symbol: "XLK", name: "Technology Select Sector SPDR" },
    { symbol: "MSFT", name: "Microsoft" },
    { symbol: "AAPL", name: "Apple" },
    { symbol: "AMZN", name: "Amazon" },
    { symbol: "GOOGL", name: "Alphabet" },
    { symbol: "META", name: "Meta" },
    { symbol: "ORCL", name: "Oracle" },
    { symbol: "CRM", name: "Salesforce" },
    { symbol: "NOW", name: "ServiceNow" }
  ],
  macro: [
    { symbol: "SPY", name: "S&P 500 ETF" },
    { symbol: "QQQ", name: "Nasdaq 100 ETF" },
    { symbol: "TLT", name: "20+ Year Treasury Bond ETF" },
    { symbol: "IEF", name: "7-10 Year Treasury Bond ETF" },
    { symbol: "^TNX", name: "10-Year Treasury Yield" },
    { symbol: "^VIX", name: "CBOE Volatility Index" },
    { symbol: "UUP", name: "US Dollar Bullish ETF" },
    { symbol: "GLD", name: "Gold ETF" }
  ],
  crypto: [
    { symbol: "BTC-USD", name: "Bitcoin" },
    { symbol: "ETH-USD", name: "Ethereum" },
    { symbol: "COIN", name: "Coinbase" },
    { symbol: "HOOD", name: "Robinhood" },
    { symbol: "MSTR", name: "MicroStrategy" }
  ],
  china: [
    { symbol: "KWEB", name: "China Internet ETF" },
    { symbol: "FXI", name: "China Large-Cap ETF" },
    { symbol: "MCHI", name: "MSCI China ETF" },
    { symbol: "BABA", name: "Alibaba" },
    { symbol: "PDD", name: "PDD" },
    { symbol: "JD", name: "JD.com" },
    { symbol: "BIDU", name: "Baidu" },
    { symbol: "TCEHY", name: "Tencent ADR" }
  ],
  general: [
    { symbol: "SPY", name: "S&P 500 ETF" },
    { symbol: "QQQ", name: "Nasdaq 100 ETF" },
    { symbol: "IWM", name: "Russell 2000 ETF" },
    { symbol: "TLT", name: "20+ Year Treasury Bond ETF" },
    { symbol: "^VIX", name: "CBOE Volatility Index" }
  ]
};

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function pctChange(now, then) {
  const current = Number(now);
  const previous = Number(then);
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function formatPct(value) {
  if (!Number.isFinite(value)) return "n/a";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function nearestPriorClose(points, targetTime) {
  const sorted = (points || [])
    .filter((point) => Number.isFinite(point.close) && Number.isFinite(point.time))
    .sort((a, b) => a.time - b.time);
  if (!sorted.length) return null;
  let candidate = sorted[0];
  for (const point of sorted) {
    if (point.time <= targetTime) candidate = point;
    else break;
  }
  return candidate.close;
}

function returnsForSeries(points) {
  const sorted = (points || [])
    .filter((point) => Number.isFinite(point.close) && Number.isFinite(point.time))
    .sort((a, b) => a.time - b.time);
  if (!sorted.length) return {};
  const latest = sorted[sorted.length - 1];
  const dayMs = 24 * 60 * 60 * 1000;
  const prev = sorted.length >= 2 ? sorted[sorted.length - 2].close : null;
  return {
    latest: latest.close,
    oneDayPct: pctChange(latest.close, prev),
    oneMonthPct: pctChange(latest.close, nearestPriorClose(sorted, latest.time - 30 * dayMs)),
    threeMonthPct: pctChange(latest.close, nearestPriorClose(sorted, latest.time - 90 * dayMs)),
    latestDate: new Date(latest.time).toISOString().slice(0, 10)
  };
}

function symbolsForQuestion(question) {
  const text = cleanText(question);
  if (/(半导体|芯片|算力|人工智能|\bAI\b|英伟达|\bNVDA\b|\bAMD\b|博通|\bAVGO\b|台积电|\bTSM\b)/iu.test(text)) return MARKET_SYMBOL_GROUPS.semiconductor;
  if (/(大型科技|软件|云|cloud|agent|微软|\bMSFT\b|苹果|\bAAPL\b|亚马逊|\bAMZN\b|谷歌|\bGOOGL\b|Meta|\bMETA\b|Oracle|\bORCL\b|Salesforce|\bCRM\b)/iu.test(text)) return MARKET_SYMBOL_GROUPS.bigTech;
  if (/(宏观|利率|美联储|Fed|流动性|通胀|债券|国债|美元|VIX|波动率)/iu.test(text)) return MARKET_SYMBOL_GROUPS.macro;
  if (/(加密|Crypto|Bitcoin|BTC|Ethereum|ETH|稳定币|Coinbase|COIN|CRCL)/iu.test(text)) return MARKET_SYMBOL_GROUPS.crypto;
  if (/(中国资产|中概|港股|A股|地缘|政策风险|KWEB|FXI|阿里|腾讯|拼多多|百度|京东)/iu.test(text)) return MARKET_SYMBOL_GROUPS.china;
  return MARKET_SYMBOL_GROUPS.general;
}

function contextFromRows({ question, rows, provider = "public-market-data", asOf = new Date().toISOString() }) {
  const usable = (rows || []).filter((row) => row && row.symbol && Number.isFinite(row.latest));
  const leaders = usable
    .filter((row) => Number.isFinite(row.oneMonthPct))
    .slice()
    .sort((a, b) => b.oneMonthPct - a.oneMonthPct)
    .slice(0, 3);
  const laggards = usable
    .filter((row) => Number.isFinite(row.oneMonthPct))
    .slice()
    .sort((a, b) => a.oneMonthPct - b.oneMonthPct)
    .slice(0, 3);
  const etfs = usable.filter((row) => ["SOXX", "SMH", "QQQ"].includes(row.symbol));
  const stocks = usable.filter((row) => !["SOXX", "SMH", "QQQ"].includes(row.symbol));

  const lines = [
    `数据来源：${provider}；生成时间：${asOf}`,
    `问题：${cleanText(question) || "未指定"}`,
    etfs.length
      ? `板块/指数：${etfs.map((row) => `${row.symbol} 最新 ${row.latest.toFixed(2)}，1日 ${formatPct(row.oneDayPct)}，1月 ${formatPct(row.oneMonthPct)}，3月 ${formatPct(row.threeMonthPct)}`).join("；")}。`
      : "",
    stocks.length
      ? `核心股票：${stocks.map((row) => `${row.symbol} 最新 ${row.latest.toFixed(2)}，1日 ${formatPct(row.oneDayPct)}，1月 ${formatPct(row.oneMonthPct)}`).join("；")}。`
      : "",
    leaders.length ? `近1月相对强势：${leaders.map((row) => `${row.symbol} ${formatPct(row.oneMonthPct)}`).join("、")}。` : "",
    laggards.length ? `近1月相对弱势：${laggards.map((row) => `${row.symbol} ${formatPct(row.oneMonthPct)}`).join("、")}。` : "",
    "事件/基本面仍需补充：最新财报与管理层指引、云厂商 capex、出口管制/供应链、电力约束、估值分位、Fed 利率与流动性。"
  ].filter(Boolean);

  return {
    provider,
    asOf,
    symbols: usable.map((row) => row.symbol),
    rows: usable,
    context: lines.join("\n")
  };
}

function yahooUrl(symbol, range = "3mo") {
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${encodeURIComponent(range)}&interval=1d`;
}

async function fetchYahooSeries(symbol, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable");
  const response = await fetchImpl(yahooUrl(symbol), {
    headers: {
      "user-agent": "Mozilla/5.0 AJM market-context"
    }
  });
  if (!response.ok) throw new Error(`${symbol} HTTP ${response.status}`);
  const payload = await response.json();
  const result = payload?.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const points = timestamps
    .map((time, index) => ({ time: Number(time) * 1000, close: Number(closes[index]) }))
    .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.close));
  if (!points.length) throw new Error(`${symbol} no chart data`);
  return points;
}

async function fetchPublicMarketContext({ question, fetchImpl, symbols } = {}) {
  const symbolSpecs = symbols || symbolsForQuestion(question);
  const rows = [];
  const errors = [];
  for (const spec of symbolSpecs) {
    try {
      const points = await fetchYahooSeries(spec.symbol, fetchImpl);
      rows.push({
        symbol: spec.symbol,
        name: spec.name,
        ...returnsForSeries(points)
      });
    } catch (error) {
      errors.push({ symbol: spec.symbol, error: error.message || String(error) });
    }
  }
  const result = contextFromRows({
    question,
    rows,
    provider: "Yahoo Chart public data",
    asOf: new Date().toISOString()
  });
  return {
    ...result,
    errors
  };
}

module.exports = {
  DEFAULT_SEMICONDUCTOR_SYMBOLS,
  MARKET_SYMBOL_GROUPS,
  symbolsForQuestion,
  returnsForSeries,
  contextFromRows,
  fetchPublicMarketContext
};
