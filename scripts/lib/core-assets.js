function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

const CORE_ASSET_ROUTES = [
  {
    id: "big_tech",
    label: "美股大型科技",
    marketGroup: "bigTech",
    domains: ["big_tech_software_cloud", "company_fundamental_research", "stock_market"],
    pattern: /(大科技|大型科技|美股科技|科技股|微软|\bMSFT\b|苹果|\bAAPL\b|亚马逊|\bAMZN\b|谷歌|\bGOOGL\b|\bGOOG\b|Meta|\bMETA\b|Oracle|\bORCL\b|Salesforce|\bCRM\b|软件云|AI Agent|智能体)/iu
  },
  {
    id: "semiconductor",
    label: "AI / 半导体 / 算力",
    marketGroup: "semiconductor",
    domains: ["ai_semis_infrastructure", "ai_tech_industry_logic", "stock_market", "manufacturing"],
    pattern: /(半导体|芯片|算力|人工智能|\bAI\b|英伟达|\bNVDA\b|\bAMD\b|博通|\bAVGO\b|台积电|\bTSM\b|\bASML\b|高通|\bQCOM\b|美光|\bMU\b)/iu
  },
  {
    id: "us_index",
    label: "美股指数 / QQQ / SPY",
    marketGroup: "usIndex",
    domains: ["macro_fed_liquidity", "stock_market", "market_regime_mainline"],
    pattern: /(QQQ|SPY|SPX|RSP|IWM|纳指|纳斯达克|Nasdaq|标普|标普500|罗素|美股指数|指数|7月.*美股|美股.*走势|美股.*后市)/iu
  },
  {
    id: "crypto",
    label: "BTC / 加密 / 稳定币",
    marketGroup: "crypto",
    domains: ["crypto_stablecoin", "stock_market"],
    pattern: /(BTC|Bitcoin|比特币|ETH|Ethereum|以太坊|Crypto|加密|稳定币|Circle|CRCL|Coinbase|COIN|MSTR)/iu
  },
  {
    id: "china_assets",
    label: "港股中概 / 中国资产",
    marketGroup: "china",
    domains: ["china_policy_geopolitics", "stock_market", "macro_policy"],
    pattern: /(港股|中概|中国资产|KWEB|FXI|MCHI|阿里|BABA|腾讯|TCEHY|拼多多|PDD|京东|JD|百度|BIDU|地缘|关税|出口管制|政策风险)/iu
  }
];

function matchCoreAssetRoute(question) {
  const text = cleanText(question);
  return CORE_ASSET_ROUTES.find((route) => route.pattern.test(text)) || null;
}

function forcedDomainForQuestion(question, config = {}) {
  const route = matchCoreAssetRoute(question);
  if (!route) return null;
  const domains = config.domains || {};
  const domainId = route.domains.find((candidate) => domains[candidate]);
  return domainId ? { domainId, route } : null;
}

module.exports = {
  CORE_ASSET_ROUTES,
  matchCoreAssetRoute,
  forcedDomainForQuestion
};
