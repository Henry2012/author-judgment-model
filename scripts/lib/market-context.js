const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { matchCoreAssetRoute } = require("./core-assets");

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
  usIndex: [
    { symbol: "QQQ", name: "Nasdaq 100 ETF" },
    { symbol: "SPY", name: "S&P 500 ETF" },
    { symbol: "RSP", name: "S&P 500 Equal Weight ETF" },
    { symbol: "IWM", name: "Russell 2000 ETF" },
    { symbol: "XLK", name: "Technology Select Sector SPDR" },
    { symbol: "TLT", name: "20+ Year Treasury Bond ETF" },
    { symbol: "IEF", name: "7-10 Year Treasury Bond ETF" }
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
  const route = matchCoreAssetRoute(text);
  if (route && MARKET_SYMBOL_GROUPS[route.marketGroup]) return MARKET_SYMBOL_GROUPS[route.marketGroup];
  if (/(宏观|利率|美联储|Fed|流动性|通胀|债券|国债|美元|VIX|波动率)/iu.test(text)) return MARKET_SYMBOL_GROUPS.macro;
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
      ? `相关标的：${stocks.map((row) => `${row.symbol} 最新 ${row.latest.toFixed(2)}，1日 ${formatPct(row.oneDayPct)}，1月 ${formatPct(row.oneMonthPct)}`).join("；")}。`
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

function projectRoot() {
  return path.resolve(__dirname, "..", "..");
}

function defaultFutuPython() {
  const localPython = path.join(projectRoot(), ".venv-futu", "bin", "python");
  if (fs.existsSync(localPython)) return localPython;
  return "python3";
}

function defaultFutuKlineScript() {
  return path.join(os.homedir(), "agent-skills", "personal", "futuapi", "scripts", "quote", "get_kline.py");
}

function futuCodeForSymbol(symbol) {
  if (symbol === "BTC-USD") return "CC.BTC";
  if (symbol === "ETH-USD") return "CC.ETH";
  if (/^[A-Z][A-Z0-9.]*$/u.test(symbol)) return `US.${symbol}`;
  return null;
}

function dateDaysAgo(days, now = new Date()) {
  const date = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

function parseJsonFromMixedOutput(output) {
  const lines = String(output || "").split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!lines[index].startsWith("{")) continue;
    try {
      return JSON.parse(lines[index]);
    } catch (_) {
      // Keep scanning because Futu may print log lines before or after JSON.
    }
  }
  throw new Error("Futu Skill did not return JSON");
}

function execFileJson(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, {
      cwd: projectRoot(),
      timeout: options.timeoutMs || 60000,
      maxBuffer: options.maxBuffer || 4 * 1024 * 1024,
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8"
      }
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error((stderr || stdout || error.message || String(error)).trim()));
        return;
      }
      try {
        resolve(parseJsonFromMixedOutput(stdout));
      } catch (parseError) {
        reject(new Error(`${parseError.message}; stderr=${String(stderr || "").trim()}`));
      }
    });
  });
}

async function fetchFutuSeries(spec, options = {}) {
  const futuCode = spec.futuCode || futuCodeForSymbol(spec.symbol);
  if (!futuCode) throw new Error(`${spec.symbol} is not mapped to a Futu code`);
  const python = options.python || process.env.AJM_FUTU_PYTHON || defaultFutuPython();
  const script = options.script || process.env.AJM_FUTU_KLINE_SCRIPT || defaultFutuKlineScript();
  const end = options.end || new Date().toISOString().slice(0, 10);
  const start = options.start || dateDaysAgo(100);
  const payload = await execFileJson(python, [
    script,
    futuCode,
    "--ktype",
    "1d",
    "--num",
    "100",
    "--start",
    start,
    "--end",
    end,
    "--json"
  ], { timeoutMs: options.timeoutMs });
  if (payload.error) throw new Error(payload.error);
  const points = (payload.data || [])
    .map((row) => ({
      time: Date.parse(String(row.time || "").replace(" ", "T")),
      close: Number(row.close)
    }))
    .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.close));
  if (!points.length) throw new Error(`${futuCode} no kline data`);
  return points;
}

async function fetchFutuMarketContext({ question, symbols, futuOptions } = {}) {
  const symbolSpecs = symbols || symbolsForQuestion(question);
  const rows = [];
  const errors = [];
  for (const spec of symbolSpecs) {
    try {
      const points = await fetchFutuSeries(spec, futuOptions || {});
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
    provider: "Futu OpenD Skill",
    asOf: new Date().toISOString()
  });
  return {
    ...result,
    errors
  };
}

async function fetchMarketContext({ question, provider = "auto", fetchImpl, symbols, futuOptions } = {}) {
  if (provider === "public" || provider === "yahoo") {
    return fetchPublicMarketContext({ question, fetchImpl, symbols });
  }
  if (provider === "futu") {
    return fetchFutuMarketContext({ question, symbols, futuOptions });
  }
  const futu = await fetchFutuMarketContext({ question, symbols, futuOptions });
  if (futu.rows && futu.rows.length) return futu;
  const fallback = await fetchPublicMarketContext({ question, fetchImpl, symbols });
  return {
    ...fallback,
    provider: `${fallback.provider} fallback after Futu OpenD Skill`,
    futu_errors: futu.errors
  };
}

module.exports = {
  DEFAULT_SEMICONDUCTOR_SYMBOLS,
  MARKET_SYMBOL_GROUPS,
  symbolsForQuestion,
  returnsForSeries,
  contextFromRows,
  fetchPublicMarketContext,
  fetchFutuMarketContext,
  fetchMarketContext,
  futuCodeForSymbol,
  parseJsonFromMixedOutput
};
