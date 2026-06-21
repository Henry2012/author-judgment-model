const fs = require("fs");
const path = require("path");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${String(value).replace(/\s+$/u, "")}\n`);
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function unique(items) {
  return Array.from(new Set((items || []).map(cleanText).filter(Boolean)));
}

function topValues(items, valueFn, limit = 8) {
  const counts = new Map();
  const firstSeen = new Map();
  for (const item of items) {
    const values = valueFn(item);
    for (const value of Array.isArray(values) ? values : [values]) {
      const key = cleanText(value);
      if (!key) continue;
      if (!firstSeen.has(key)) firstSeen.set(key, firstSeen.size);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || firstSeen.get(a[0]) - firstSeen.get(b[0]))
    .slice(0, limit)
    .map(([value]) => value);
}

function stableHash(value) {
  let hash = 0;
  for (const char of String(value || "")) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash.toString(36);
}

function conceptIdForTerm(term) {
  const ascii = String(term || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return ascii ? `concept_${ascii}` : `concept_${stableHash(term)}`;
}

function displayNameForConcept(id, aliases) {
  const chineseAlias = aliases.find((alias) => /[\u3400-\u9fff]/u.test(alias));
  if (chineseAlias) return chineseAlias;
  return String(id || "concept").replace(/^concept_/, "").replace(/_/g, " ");
}

function excerptText(unit) {
  return cleanText([unit.claim, unit.evidence_excerpt].join(" "));
}

function termCandidates(unit) {
  const terms = [];
  const object = cleanText(unit.object);
  const text = excerptText(unit);
  if (object && object.length <= 18 && text.includes(object)) terms.push(object);
  const suffixMatches = text.match(/[\u3400-\u9fffA-Za-z0-9]{1,12}(?:链|线|板块|模块|机制|模型|主线|周期|成本|约束|风险|税|需求)/gu) || [];
  terms.push(...suffixMatches);
  for (const term of [...terms]) {
    const chars = Array.from(term);
    if (/^[\u3400-\u9fff]+$/u.test(term) && chars.length >= 4) {
      for (let i = 0; i <= chars.length - 3; i += 1) {
        const window = chars.slice(i, i + 3).join("");
        if (/(链|线|税|险|求)$/u.test(window)) terms.push(window);
      }
      for (let i = 0; i <= chars.length - 4; i += 1) {
        const window = chars.slice(i, i + 4).join("");
        if (/(板块|模块|机制|模型|主线|周期|成本|约束|风险|需求)$/u.test(window)) terms.push(window);
      }
    }
  }
  return unique(
    terms
      .map((term) => term.replace(/^(关于|围绕|判断|问题|当前|中国|国内)/u, ""))
      .filter((term) => term.length >= 2 && term.length <= 18)
      .filter((term) => !/^(与|态与|的|是|在|但|其是|了|低了|近的|次|一次|哪怕是|要把每一次)/u.test(term))
      .filter((term) => !/^[A-Za-z ]+$/u.test(term))
  );
}

function addToGroup(groups, key, unit, seed = {}) {
  if (!groups.has(key)) {
    groups.set(key, {
      key,
      seed,
      units: []
    });
  }
  const group = groups.get(key);
  if (!group.units.some((item) => item.unit_id === unit.unit_id)) group.units.push(unit);
}

function buildGroups(units) {
  const groups = new Map();
  for (const unit of units || []) {
    for (const conceptId of unit.concept_ids || []) {
      addToGroup(groups, `concept:${conceptId}`, unit, { id: conceptId });
    }
    for (const term of termCandidates(unit)) {
      addToGroup(groups, `term:${term}`, unit, { term });
    }
  }
  return Array.from(groups.values());
}

function dateRange(units) {
  const dates = units
    .map((unit) => String(unit.created_at || "").slice(0, 10))
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
    .sort();
  if (!dates.length) return "";
  return dates[0] === dates[dates.length - 1] ? dates[0] : `${dates[0]} to ${dates[dates.length - 1]}`;
}

function fallbackTrigger(name, domains) {
  return `问题询问「${name}」并落入${domains.join(" / ") || "作者稳定判断域"}时触发。`;
}

function fallbackBoundary() {
  return "这是基于历史语料的概念候选，需要结合实时事实外部验证。";
}

function fallbackCounterexample(name) {
  return `只出现「${name}」字面相似、但缺少同一判断变量或语境时不应套用。`;
}

function qualityFor(candidate, options = {}) {
  const minEvidenceUnits = Number(options.minEvidenceUnits || 3);
  const failures = [];
  if ((candidate.evidence_unit_ids || []).length < minEvidenceUnits) {
    failures.push(`support_count_below_${minEvidenceUnits}`);
  }
  if (!candidate.aliases?.length) failures.push("missing_aliases");
  if (!candidate.domains?.length) failures.push("missing_domains");
  if (!candidate.trigger_conditions?.length) failures.push("missing_trigger_conditions");
  if (!candidate.boundary_conditions?.length) failures.push("missing_boundary_conditions");
  return {
    status: failures.length ? "fail" : "pass",
    support_count: candidate.evidence_unit_ids.length,
    failures
  };
}

function buildConceptCandidate(group, options = {}) {
  const units = group.units;
  const domains = topValues(units, (unit) => unit.domain, 5);
  const aliases = topValues(units, (unit) => {
    const seeded = group.seed.term ? [group.seed.term] : [];
    return [...seeded, ...termCandidates(unit)];
  }, 8);
  const id = group.seed.id || conceptIdForTerm(aliases[0] || group.key);
  const name = displayNameForConcept(id, aliases);
  const candidate = {
    id,
    name,
    discovery_source: group.seed.id ? "concept_id" : "term_cluster",
    aliases,
    domains,
    trigger_conditions: unique([
      ...units.flatMap((unit) => unit.trigger_conditions || []),
      fallbackTrigger(name, domains)
    ]).slice(0, 8),
    required_variables: topValues(units, (unit) => unit.variables || [], 10),
    boundary_conditions: unique([
      ...units.flatMap((unit) => unit.boundary_conditions || []),
      fallbackBoundary(),
      "不能仅因命中别名就给高置信结论。"
    ]).slice(0, 8),
    counterexamples: unique([
      ...units.flatMap((unit) => unit.counterexamples || []),
      fallbackCounterexample(name)
    ]).slice(0, 8),
    time_scope: topValues(units, (unit) => unit.time_scope, 1)[0] || dateRange(units),
    evidence_unit_ids: units.map((unit) => unit.unit_id).slice(0, 24)
  };
  candidate.quality = qualityFor(candidate, options);
  candidate.review_decision = group.seed.id && candidate.quality.status === "pass" ? "accept" : "review";
  return candidate;
}

function dedupeCandidates(candidates) {
  const byId = new Map();
  for (const candidate of candidates) {
    const existing = byId.get(candidate.id);
    if (!existing || candidate.evidence_unit_ids.length > existing.evidence_unit_ids.length) {
      byId.set(candidate.id, candidate);
    }
  }
  return Array.from(byId.values()).sort(
    (a, b) => b.evidence_unit_ids.length - a.evidence_unit_ids.length || a.id.localeCompare(b.id)
  );
}

const tradingDomains = new Set([
  "market_regime_mainline",
  "trend_structure_timing",
  "risk_position_management",
  "ai_tech_industry_logic",
  "trading_psychology_execution",
  "intraday_market_reading"
]);

const tradingSignals = {
  topic: ["主线", "非主线", "产业链", "科技", "人工智能", "AI", "算力", "光模块", "光通信", "半导体", "芯片"],
  action: ["买", "买入", "继续买", "低吸", "追涨", "持有", "持有到", "减仓", "止盈", "止损", "仓位", "底仓"],
  risk: ["风险", "止损", "仓位", "亏损", "失效", "回撤", "追涨", "加速", "过热"],
  time: ["回踩", "加速区", "加速", "月底", "7月底", "七月底", "短期", "中期", "趋势", "反弹", "持有到"]
};

const tradingDomainConcepts = {
  ai_semis_infrastructure: {
    id: "ai_compute_semis_infrastructure",
    name: "AI / 算力 / 半导体基础设施",
    aliases: ["AI", "人工智能", "算力", "半导体", "芯片", "英伟达", "NVDA", "台积电", "TSM", "数据中心", "电力", "资本开支"],
    required_variables: ["ai_demand", "compute_supply", "power_constraint", "capex_cycle", "supply_chain_position", "valuation", "risk_reward"],
    trigger: "问题询问 AI、算力、半导体、芯片、数据中心、电力或资本开支是否仍构成投资主线。",
    boundary: "不能只因 AI 热度或单一龙头上涨就给结论，必须同时看需求、供给、电力约束、资本开支、估值和风险收益。",
    counterexample: "只有题材情绪或价格上涨、缺少需求/供给/估值证据时不应套用。"
  },
  big_tech_software_cloud: {
    id: "us_big_tech_software_cloud",
    name: "美股大型科技与软件云",
    aliases: ["大型科技", "美股科技", "软件云", "云", "AI Agent", "智能体", "微软", "MSFT", "谷歌", "GOOGL", "亚马逊", "AMZN", "META"],
    required_variables: ["distribution", "enterprise_trust", "cloud_revenue", "agent_adoption", "data_control", "margin", "competitive_moat"],
    trigger: "问题询问美股大型科技、软件云、AI Agent、企业分发或云业务竞争力。",
    boundary: "不能只看单个产品发布或模型能力，必须回到分发、企业信任、云收入、数据控制、利润率和护城河。",
    counterexample: "只有产品热度但缺少企业采用、收入或利润率证据时不应套用。"
  },
  macro_fed_liquidity: {
    id: "macro_fed_liquidity_cycle",
    name: "宏观利率 / Fed / 流动性",
    aliases: ["宏观", "利率", "Fed", "美联储", "降息", "通胀", "CPI", "PCE", "美债", "流动性", "TGA", "QT", "QE"],
    required_variables: ["inflation_path", "fed_reaction_function", "liquidity_condition", "treasury_cash_balance", "reserve_level", "fiscal_impulse", "asset_price_impact"],
    trigger: "问题询问利率、美联储、降息、通胀、美债、TGA、准备金或流动性变化对资产价格的影响。",
    boundary: "不能把单次数据或新闻直接等同于政策转向，必须看联储反应函数、财政/流动性传导和资产价格影响。",
    counterexample: "缺少政策反应函数或资产价格传导路径时不应套用。"
  },
  company_fundamental_research: {
    id: "company_fundamental_earnings_catalyst",
    name: "个股基本面与财报催化",
    aliases: ["个股", "基本面", "财报", "估值", "PE", "营收", "利润", "毛利", "指引", "管理层", "商业模式", "护城河", "催化"],
    required_variables: ["revenue_growth", "margin_profile", "valuation_multiple", "management_guidance", "business_moat", "demand_supply_balance", "research_depth"],
    trigger: "问题询问某只个股是否可以买、持有、等待财报或依赖基本面/估值催化。",
    boundary: "不能只靠 K 线、消息或短线情绪替代财报、估值、商业模式和行业研究。",
    counterexample: "缺少财报、估值、业务质量或催化证据时不应套用。"
  },
  portfolio_risk_positioning: {
    id: "portfolio_risk_budget_stop_loss",
    name: "组合仓位 / 风险预算 / 止损",
    aliases: ["组合", "仓位", "加仓", "减仓", "清仓", "止损", "止盈", "回撤", "风险预算", "退出计划", "持有"],
    required_variables: ["position_size", "conviction_source", "drawdown_tolerance", "risk_budget", "fundamental_thesis", "technical_timing", "exit_plan"],
    trigger: "问题询问仓位、加仓、减仓、止损、止盈、回撤承受或能否继续持有。",
    boundary: "不能替代个人账户风险承受能力和交易计划，未明确仓位、止损和退出计划时不能给确定性买卖结论。",
    counterexample: "没有风险预算、止损计划或 conviction 来源只是跟单时不应套用。"
  },
  crypto_stablecoin: {
    id: "crypto_stablecoin_financial_infra",
    name: "加密 / 稳定币 / 金融基础设施",
    aliases: ["Crypto", "加密", "稳定币", "CRCL", "Circle", "BTC", "比特币", "MSTR", "IPO", "监管", "解禁"],
    required_variables: ["stablecoin_adoption", "regulatory_risk", "valuation", "lockup_supply", "position_size", "market_sentiment", "thesis_durability"],
    trigger: "问题询问稳定币、CRCL、BTC、加密资产或加密金融基础设施的投资逻辑。",
    boundary: "不能只因赛道长期空间大就忽略监管、估值、解禁供给、市场情绪和仓位风险。",
    counterexample: "只有市场情绪或赛道叙事、缺少采用/监管/估值证据时不应套用。"
  },
  china_policy_geopolitics: {
    id: "china_assets_geopolitical_policy_risk",
    name: "中国资产 / 地缘政策风险",
    aliases: ["中国资产", "中国", "港股", "中概", "地缘", "政策", "关税", "出口管制", "稀土", "台湾", "贸易", "估值折价"],
    required_variables: ["policy_direction", "geopolitical_risk", "tariff_impact", "export_control", "china_demand", "valuation_discount", "negotiation_path"],
    trigger: "问题询问中国资产、港股中概、关税、出口管制、地缘政策或估值折价。",
    boundary: "不能把单条谈判消息或政策传闻直接当成政策方向变化，必须拆开政策路径、贸易限制、需求和估值折价。",
    counterexample: "没有政策路径、出口限制影响或估值折价判断时不应套用。"
  }
};

function includesAny(text, terms) {
  return terms.some((term) => text.includes(term));
}

function tradingSignalKinds(unit) {
  const text = excerptText(unit);
  const object = cleanText(unit.object);
  const combined = `${object} ${text} ${(unit.trigger_conditions || []).join(" ")} ${(unit.boundary_conditions || []).join(" ")}`;
  return Object.entries(tradingSignals)
    .filter(([, terms]) => includesAny(combined, terms))
    .map(([kind]) => kind);
}

function isTradingStructuralUnit(unit) {
  const kinds = tradingSignalKinds(unit);
  return tradingDomains.has(unit.domain) || kinds.length >= 2;
}

function topTradingAliases(units) {
  const aliases = [];
  for (const terms of Object.values(tradingSignals)) {
    for (const term of terms) {
      if (units.some((unit) => `${cleanText(unit.object)} ${excerptText(unit)}`.includes(term))) aliases.push(term);
    }
  }
  return unique(aliases).slice(0, 12);
}

function buildTradingStructureCandidate(units, options = {}) {
  const tradingUnits = (units || []).filter(isTradingStructuralUnit);
  if (tradingUnits.length < Number(options.minEvidenceUnits || 3)) return null;

  const aliases = topTradingAliases(tradingUnits);
  const domains = topValues(tradingUnits, (unit) => unit.domain, 6);
  const candidate = {
    id: "trading_mainline_timing_risk",
    name: "主线-时机-风控交易框架",
    discovery_source: "trading_structure",
    aliases: unique(["主线", "低吸", "追涨", "持有", "仓位", "止损", ...aliases]).slice(0, 12),
    domains,
    trigger_conditions: unique([
      ...tradingUnits.flatMap((unit) => unit.trigger_conditions || []),
      "问题同时询问主题是否仍是主线、还能不能买/持有、交易时间窗口或标的处理。"
    ]).slice(0, 10),
    required_variables: unique([
      "mainline_clarity",
      "trend_direction",
      "entry_timing",
      "position_size",
      "stop_loss",
      "holding_period",
      "chase_risk",
      ...tradingUnits.flatMap((unit) => unit.variables || [])
    ]).slice(0, 14),
    boundary_conditions: unique([
      ...tradingUnits.flatMap((unit) => unit.boundary_conditions || []),
      "不能替代实时行情、估值、个股基本面和个人交易计划。",
      "处在加速区或情绪过热时，必须先提示追涨风险。",
      "未明确仓位、止损和时间窗口时，不应给确定性买卖结论。"
    ]).slice(0, 10),
    counterexamples: unique([
      ...tradingUnits.flatMap((unit) => unit.counterexamples || []),
      "只出现主线、低吸、追涨等词，但没有主题、趋势、动作和风险边界同时出现时不适用。",
      "没有止损计划或趋势已经失效时，不能套用持有结论。"
    ]).slice(0, 10),
    time_scope: topValues(tradingUnits, (unit) => unit.time_scope, 1)[0] || dateRange(tradingUnits),
    evidence_unit_ids: tradingUnits.map((unit) => unit.unit_id).slice(0, 36)
  };
  candidate.quality = qualityFor(candidate, options);
  candidate.review_decision = "review";
  return candidate;
}

function buildTradingDomainCandidates(units, options = {}) {
  const minEvidenceUnits = Number(options.minEvidenceUnits || 3);
  return Object.entries(tradingDomainConcepts)
    .map(([domainId, template]) => {
      const domainUnits = (units || []).filter((unit) => unit.domain === domainId);
      if (domainUnits.length < minEvidenceUnits) return null;
      const candidate = {
        id: template.id,
        name: template.name,
        discovery_source: "trading_domain_split",
        aliases: unique([...template.aliases, ...topTradingAliases(domainUnits), ...topValues(domainUnits, (unit) => termCandidates(unit), 6)]).slice(0, 16),
        domains: [domainId],
        trigger_conditions: unique([
          ...domainUnits.flatMap((unit) => unit.trigger_conditions || []),
          template.trigger
        ]).slice(0, 10),
        required_variables: unique([
          ...template.required_variables,
          ...domainUnits.flatMap((unit) => unit.variables || [])
        ]).slice(0, 16),
        boundary_conditions: unique([
          ...domainUnits.flatMap((unit) => unit.boundary_conditions || []),
          template.boundary,
          fallbackBoundary(),
          "不能仅因命中别名就给高置信结论。"
        ]).slice(0, 10),
        counterexamples: unique([
          ...domainUnits.flatMap((unit) => unit.counterexamples || []),
          template.counterexample
        ]).slice(0, 10),
        time_scope: topValues(domainUnits, (unit) => unit.time_scope, 1)[0] || dateRange(domainUnits),
        evidence_unit_ids: domainUnits.map((unit) => unit.unit_id).slice(0, 36)
      };
      candidate.quality = qualityFor(candidate, options);
      candidate.review_decision = "review";
      return candidate;
    })
    .filter(Boolean);
}

function discoverConceptCandidates({ units, minEvidenceUnits = 3, maxCandidates = 30, strategy = "term" } = {}) {
  const options = { minEvidenceUnits };
  const structuralCandidates =
    strategy === "trading"
      ? [buildTradingStructureCandidate(units, options), ...buildTradingDomainCandidates(units, options)].filter(Boolean)
      : [];
  const termCandidates = strategy === "trading" ? [] : buildGroups(units).map((group) => buildConceptCandidate(group, options));
  const candidates = dedupeCandidates([...structuralCandidates, ...termCandidates]).slice(0, maxCandidates);
  return {
    version: strategy === "trading" ? "0.2.3" : "0.2.1",
    generated_at: new Date().toISOString(),
    quality_gate: {
      min_evidence_units: Number(minEvidenceUnits),
      strategy,
      pass: candidates.filter((candidate) => candidate.quality.status === "pass").length,
      fail: candidates.filter((candidate) => candidate.quality.status !== "pass").length
    },
    candidates
  };
}

function reviewTemplateFor(candidates, version = "0.2.1") {
  return {
    version,
    instructions: [
      "Review each concept. Keep review_decision=accept to write it into profile.concepts.",
      "Set review_decision=reject for pseudo-concepts, or edit aliases/triggers/boundaries/counterexamples before applying."
    ],
    concepts: (candidates || []).map((candidate) => ({
      review_decision: candidate.review_decision || (candidate.quality?.status === "pass" ? "accept" : "review"),
      id: candidate.id,
      name: candidate.name,
      discovery_source: candidate.discovery_source || "unknown",
      aliases: candidate.aliases || [],
      domains: candidate.domains || [],
      trigger_conditions: candidate.trigger_conditions || [],
      required_variables: candidate.required_variables || [],
      boundary_conditions: candidate.boundary_conditions || [],
      counterexamples: candidate.counterexamples || [],
      time_scope: candidate.time_scope || "",
      evidence_unit_ids: candidate.evidence_unit_ids || [],
      quality: candidate.quality || {}
    }))
  };
}

function reviewMarkdownFor(candidates) {
  const rows = (candidates || []).map((candidate) =>
    [
      `## ${candidate.name} (${candidate.id})`,
      "",
      `- Review decision: ${candidate.review_decision || "review"}`,
      `- Discovery source: ${candidate.discovery_source || "unknown"}`,
      `- Quality: ${candidate.quality?.status || "unknown"}; support=${candidate.quality?.support_count || 0}`,
      `- Aliases: ${(candidate.aliases || []).join(", ")}`,
      `- Domains: ${(candidate.domains || []).join(", ")}`,
      `- Triggers: ${(candidate.trigger_conditions || []).join(" / ")}`,
      `- Boundaries: ${(candidate.boundary_conditions || []).join(" / ")}`,
      `- Counterexamples: ${(candidate.counterexamples || []).join(" / ")}`,
      `- Evidence units: ${(candidate.evidence_unit_ids || []).join(", ")}`
    ].join("\n")
  );
  return ["# Concept Review", "", "Edit `concept-review-template.json` for final decisions.", "", ...rows].join("\n");
}

function exportConceptReviewPack({ candidates, outDir, version = "0.2.1" }) {
  const resolvedOutDir = path.resolve(outDir);
  const candidatesPath = path.join(resolvedOutDir, "concept-candidates.json");
  const reviewTemplatePath = path.join(resolvedOutDir, "concept-review-template.json");
  const reviewMarkdownPath = path.join(resolvedOutDir, "concept-review.md");
  writeJson(candidatesPath, { version, candidates });
  writeJson(reviewTemplatePath, reviewTemplateFor(candidates, version));
  writeFile(reviewMarkdownPath, reviewMarkdownFor(candidates));
  return {
    outDir: resolvedOutDir,
    candidatesPath,
    reviewTemplatePath,
    reviewMarkdownPath,
    candidates: candidates.length
  };
}

function conceptForProfile(concept) {
  return {
    id: concept.id,
    name: concept.name || concept.id,
    aliases: concept.aliases || [],
    domains: concept.domains || [],
    trigger_conditions: concept.trigger_conditions || [],
    required_variables: concept.required_variables || [],
    boundary_conditions: concept.boundary_conditions || [],
    counterexamples: concept.counterexamples || [],
    time_scope: concept.time_scope || "",
    evidence_unit_ids: concept.evidence_unit_ids || []
  };
}

function applyConceptReviewToProfile({ review, profile, reviewId }) {
  const accepted = (review.concepts || []).filter((concept) => concept.review_decision === "accept");
  const existing = new Map((profile.concepts || []).map((concept) => [concept.id, concept]));
  for (const concept of accepted) {
    existing.set(concept.id, conceptForProfile(concept));
  }
  return {
    ...profile,
    concepts: Array.from(existing.values()),
    update_history: [
      ...(profile.update_history || []),
      {
        updated_at: new Date().toISOString(),
        event: "concepts_applied",
        review_id: reviewId || "concept_review",
        accepted: accepted.length
      }
    ]
  };
}

function applyConceptReviewToProfileFromFiles(options) {
  const review = readJson(options.reviewPath);
  const profile = readJson(options.profilePath);
  const updated = applyConceptReviewToProfile({
    review,
    profile,
    reviewId: options.reviewId
  });
  const outPath = options.outPath ? path.resolve(options.outPath) : path.resolve(options.profilePath);
  writeJson(outPath, updated);
  return {
    outPath,
    accepted: (review.concepts || []).filter((concept) => concept.review_decision === "accept").length,
    total: (review.concepts || []).length
  };
}

function discoverConceptCandidatesFromFiles(options) {
  const units = readJson(options.unitsPath);
  const result = discoverConceptCandidates({
    units,
    minEvidenceUnits: options.minEvidenceUnits,
    maxCandidates: options.maxCandidates,
    strategy: options.strategy
  });
  const exported = exportConceptReviewPack({
    candidates: result.candidates,
    outDir: options.outDir,
    version: result.version
  });
  return {
    ...result,
    paths: exported
  };
}

module.exports = {
  discoverConceptCandidates,
  discoverConceptCandidatesFromFiles,
  exportConceptReviewPack,
  applyConceptReviewToProfile,
  applyConceptReviewToProfileFromFiles
};
