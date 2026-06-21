const fs = require("fs");
const path = require("path");
const {
  labelActionTendency,
  labelConfidence,
  labelDomain,
  labelVariables,
  localizeBoundaries,
  localizedModelSummary
} = require("./zh-localize");
const { forcedDomainForQuestion } = require("./core-assets");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function termScore(text, terms, weight = 1) {
  return (terms || []).reduce((sum, term) => {
    const value = cleanText(term);
    return value && text.includes(value) ? sum + weight : sum;
  }, 0);
}

function modelForDomain(profile, domainId) {
  return (profile.mental_models || []).find((model) => (model.domains || []).includes(domainId));
}

function scoreConcept(text, concept) {
  const aliasScore = termScore(text, concept.aliases, 8);
  const triggerScore = termScore(text, concept.trigger_conditions, 3);
  const variableScore = termScore(text, concept.required_variables, 1);
  return aliasScore + triggerScore + variableScore;
}

function conceptSpecificity(concept) {
  const domainCount = Array.isArray(concept.domains) && concept.domains.length ? concept.domains.length : 99;
  const sourceBonus = concept.discovery_source === "trading_domain_split" ? -1 : 0;
  return domainCount + sourceBonus;
}

function matchConcept(question, profile, config = {}) {
  const text = cleanText(question);
  const profileConcepts = Array.isArray(profile.concepts) ? profile.concepts : [];
  const configConcepts = Array.isArray(config.concepts) ? config.concepts : [];
  const conceptById = new Map(configConcepts.map((concept) => [concept.id, concept]));
  const concepts = profileConcepts.length ? profileConcepts : configConcepts;
  const scored = concepts
    .map((concept) => {
      const merged = { ...(conceptById.get(concept.id) || {}), ...concept };
      return { concept: merged, score: scoreConcept(text, merged) };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || conceptSpecificity(a.concept) - conceptSpecificity(b.concept));
  return scored[0]?.concept || null;
}

function classifyQuestion(question, config, profile) {
  const concept = matchConcept(question, profile, config);
  if (concept?.domains?.length) return concept.domains[0];

  const forced = forcedDomainForQuestion(question, config);
  if (forced) return forced.domainId;

  const text = cleanText(question);
  const scored = Object.entries(config.domains || {})
    .map(([domainId, domain]) => {
      const model = modelForDomain(profile, domainId);
      return {
        domainId,
        score:
          termScore(text, domain.priority_keywords, 8) +
          termScore(text, domain.keywords, 3) +
          termScore(text, domain.variables, 1) +
          termScore(text, [model?.name, ...(model?.variables || [])], 1),
        profileUnits: profile.domain_map?.[domainId]?.unit_count || 0
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.profileUnits - a.profileUnits);

  return scored[0]?.domainId || "general";
}

function findModel(profile, domain) {
  return (profile.mental_models || []).find((model) => (model.domains || []).includes(domain));
}

function findHeuristic(profile, domain) {
  return (profile.decision_heuristics || []).find((heuristic) => heuristic.id === `heuristic_${domain}`);
}

function evidenceTermsFor(question, config, domain) {
  const text = cleanText(question);
  const domainConfig = config?.domains?.[domain] || {};
  const concept = matchConcept(question, { concepts: config?.concepts || [] }, config);
  return Array.from(
    new Set(
      [
        ...(concept?.aliases || []),
        ...(concept?.required_variables || []),
        ...(domainConfig.priority_keywords || []),
        ...(domainConfig.keywords || []),
        ...(domainConfig.variables || [])
      ].map(cleanText)
    )
  ).filter((term) => term && text.includes(term));
}

function evidenceMatchScore(unit, terms) {
  const text = cleanText([unit.claim, unit.evidence_excerpt, unit.object, ...(unit.variables || [])].join(" "));
  return terms.reduce((score, term) => score + (text.includes(term) ? Math.max(1, term.length) : 0), 0);
}

function buildEvidenceTrace(model, units, options = {}) {
  const unitById = new Map(units.map((unit) => [unit.unit_id, unit]));
  const terms = evidenceTermsFor(options.question || "", options.config || {}, options.domain || "");
  const modelRank = new Map((model?.evidence_unit_ids || []).map((unitId, index) => [unitId, index]));
  const candidates = Array.from(
    new Map(
      [
        ...(model?.evidence_unit_ids || []).map((unitId) => unitById.get(unitId)),
        ...units.filter((unit) => unit.domain === options.domain)
      ]
        .filter(Boolean)
        .map((unit) => [unit.unit_id, unit])
    ).values()
  );
  return candidates
    .map((unit, index) => ({
      unit,
      index,
      score: evidenceMatchScore(unit, terms),
      modelIndex: modelRank.has(unit.unit_id) ? modelRank.get(unit.unit_id) : Number.MAX_SAFE_INTEGER
    }))
    .sort((a, b) => b.score - a.score || a.modelIndex - b.modelIndex || a.index - b.index)
    .slice(0, 5)
    .map(({ unit }) => ({
      unit_id: unit.unit_id,
      source_post_id: unit.source_post_id,
      created_at: unit.created_at,
      evidence_excerpt: unit.evidence_excerpt,
      source_url: unit.source_url
    }));
}

function confidenceFor(profile, domain, trace) {
  const domainInfo = profile.domain_map?.[domain];
  if (!domainInfo || !trace.length) return "low";
  if (domainInfo.unit_count >= 20 && trace.length >= 3) return "high";
  if (domainInfo.unit_count >= 5) return "medium";
  return "low";
}

function containsAny(text, terms) {
  return terms.some((term) => text.includes(term));
}

function directConclusionFor({ question, domain, variables, config, concept }) {
  const text = cleanText(question);
  const domainLabel = labelDomain(domain, config);
  const variableText = labelVariables(variables).join("、") || "语料支持的核心变量";

  if (concept?.id === "optical_ai_chain") {
    return [
      `按该作者判断模型，这个问题触发「${concept.name}」概念，不是简单问“能不能买”，应合并看产业逻辑、趋势结构和风控仓位。`,
      "更接近的结论是：先确认光通信/算力链的产业需求、供给约束和科技主线是否仍成立；若逻辑仍强但短期已经加速，应避免追涨，倾向等待回踩或用仓位和止损约束风险。",
      "具体到易中天、三只标的、以及持有到7月底，历史语料不足以替代实时行情和实时交易判断。"
    ].join("");
  }

  if (domain === "real_estate" && containsAny(text, ["未来", "房价", "涨", "跌", "反弹", "杭州"])) {
    return [
      "按该作者判断模型，不能直接给“杭州房价一定涨/跌”的单点预测。",
      `更接近的结论是：先看${variableText}；如果流动性、租售比和退出成本没有明显改善，即使城市基本面不错，也应偏谨慎，不宜把“未来会涨”当作默认前提。`,
      "涉及未来价格和实时成交，需要外部数据核验后再应用这个判断模型。"
    ].join("");
  }

  if (domain === "ai_tech_industry_logic") {
    return [
      `按该作者判断模型，这个问题属于「${domainLabel}」，不是简单问“能不能买”。`,
      `更接近的结论是：先确认产业需求、供给约束、业绩增长和科技主线是否仍成立；若逻辑仍强但短期已经加速，应避免追涨，倾向等待回踩或用风控约束仓位。`,
      "具体到单只标的和持有到某个日期，历史语料不足以直接替代实时交易判断。"
    ].join("");
  }

  if (concept?.id === "ai_compute_semis_infrastructure" || domain === "ai_semis_infrastructure") {
    return [
      `按该作者判断模型，这个问题触发「${concept?.name || domainLabel}」，不能只用“7月会不会涨”来回答。`,
      "更接近的结论是：美股半导体仍应先看 AI 需求是否继续兑现、算力供给是否紧、数据中心资本开支是否持续、电力/供应链约束是否强化，以及估值是否已经提前透支。",
      "如果这些变量继续共振，板块更像是仍在主线内寻找结构性机会；如果只是短线情绪升温、估值抬高但基本面和资本开支没有新增证据，则应降低追涨冲动，等待财报、指引或回撤后的风险收益改善。",
      "7月这种具体时间窗口需要实时行情、估值和财报日程外部核验，AJM 这里只能给判断框架和倾向，不能给确定买卖指令。"
    ].join("");
  }

  if (domain === "macro_fed_liquidity" && containsAny(text, ["qqq", "QQQ", "纳指", "纳斯达克", "美股", "指数", "标普", "SPY", "7月", "下半年", "走势"])) {
    return [
      `按该作者判断模型，这个问题属于「${domainLabel}」，可以回答，但不能简化成“7月一定涨/跌”。`,
      "更接近的结论是：先看 QQQ/纳指所处的估值位置、EPS 预期、涨幅与参与度，再看通胀数据、美联储反应函数、长债利率和流动性是否配合。",
      "如果盈利预期仍能兑现、利率/流动性没有明显反向冲击，指数更像是在高位震荡中继续寻找结构性机会；如果估值已经偏高、情绪 FOMO 且通胀或长债利率反弹，则要预设 5% 级别回调风险，用降 beta、移动止盈或控制仓位处理。",
      "因此这类问题应给概率判断：用实时行情、估值和宏观数据合成，而不是直接给确定预测。"
    ].join("");
  }

  if (domain === "trend_structure_timing") {
    return [
      `按该作者判断模型，这个问题应先判断趋势结构和买卖时机。`,
      "更接近的结论是：上升趋势和强逻辑未破时不轻易猜顶，但加速区不追涨；回踩质量好、逻辑不变时再考虑低吸。"
    ].join("");
  }

  if (domain === "risk_position_management") {
    return [
      `按该作者判断模型，这个问题应先进入风控和仓位管理。`,
      "更接近的结论是：强势主线中可以保留底仓思维，但不能用“继续持有”替代止损、仓位和逻辑复核。"
    ].join("");
  }

  return `使用该作者的「${domainLabel}」判断模型时，应通过${variableText}来评估这个问题，并在结论前说明边界和置信度。`;
}

function buildReasonedAnswer({ question, domain, model, variables, evidenceTrace, confidence, boundaries, config, concept }) {
  const variableText = labelVariables(variables).join("、") || "语料支持的核心变量";
  const evidenceText = evidenceTrace
    .slice(0, 3)
    .map((item) => `${item.unit_id}（${item.created_at || "日期未知"}）`)
    .join("、");
  const boundaryText = localizeBoundaries(boundaries).slice(0, 2).join(" ");

  return [
    `直接回答：${directConclusionFor({ question, domain, variables, config, concept })}`,
    `可能的判断逻辑：${localizedModelSummary({ domain, variables, config })}`,
    evidenceText ? `证据链：${evidenceText}。` : "证据链：未找到可引用的证据单元。",
    `置信度：${labelConfidence(confidence)}。边界：${boundaryText}`
  ].join("\n");
}

function answerQuestion({ question, profile, units, config }) {
  const matchedConcept = matchConcept(question, profile, config);
  const domain = classifyQuestion(question, config, profile);
  const model = findModel(profile, domain);
  const heuristic = findHeuristic(profile, domain);
  const evidenceTrace = buildEvidenceTrace(model, units, { question, config, domain });
  const confidence = confidenceFor(profile, domain, evidenceTrace);
  const variables = model?.variables || heuristic?.priority_variables || [];

  if (!model) {
    const localizedBoundaries = localizeBoundaries(profile.honest_boundaries || []);
    const actionCode = "refuse_or_downgrade_confidence";
    return {
      direct_answer: "当前作者判断档案不支持对这个问题给出高置信回答。",
      reasoned_answer: [
        `直接回答：当前作者判断档案不支持对「${question}」给出高置信回答。`,
        "可能的判断逻辑：未匹配到有证据支持的判断模型。",
        "证据链：未找到可引用的证据单元。",
        `置信度：低。边界：${localizedBoundaries[0] || "语料不支持的主题应拒答或降低置信度。"}`
      ].join("\n"),
      question_classification: domain,
      question_classification_label: labelDomain(domain, config),
      likely_judgment_model: null,
      key_variables: [],
      key_variable_labels: [],
      evidence_trace: [],
      action_tendency: labelActionTendency(actionCode),
      boundaries_and_confidence: {
        confidence: "low",
        confidence_label: "低",
        boundaries: localizedBoundaries
      }
    };
  }

  const boundaries = Array.from(new Set([...(model.limitations || []), ...(profile.honest_boundaries || [])]));
  const variableText = labelVariables(variables).join("、") || "语料支持的核心变量";
  const actionCode = "apply_model_with_boundaries";

  return {
    direct_answer: directConclusionFor({ question, domain, variables, config, concept: matchedConcept }),
    reasoned_answer: buildReasonedAnswer({
      question,
      domain,
      model,
      variables,
      evidenceTrace,
      confidence,
      boundaries,
      config,
      concept: matchedConcept
    }),
    question_classification: domain,
    question_classification_label: labelDomain(domain, config),
    likely_judgment_model: {
      id: model.id,
      name: labelDomain(domain, config),
      definition: localizedModelSummary({ domain, variables, config })
    },
    key_variables: variables,
    key_variable_labels: labelVariables(variables),
    matched_concept: matchedConcept
      ? {
          id: matchedConcept.id,
          name: matchedConcept.name,
          aliases: matchedConcept.aliases || [],
          domains: matchedConcept.domains || []
        }
      : null,
    trigger_conditions: matchedConcept?.trigger_conditions || [],
    boundary_conditions: matchedConcept?.boundary_conditions || [],
    evidence_trace: evidenceTrace,
    action_tendency: labelActionTendency(actionCode),
    boundaries_and_confidence: {
      confidence,
      confidence_label: labelConfidence(confidence),
      boundaries: localizeBoundaries(boundaries)
    }
  };
}

function answerFromFiles(options) {
  const profile = readJson(options.profilePath);
  const units = readJson(options.unitsPath);
  const config = readJson(options.configPath || path.join(process.cwd(), "configs/weibo.default.json"));
  return answerQuestion({
    question: options.question,
    profile,
    units,
    config
  });
}

module.exports = {
  classifyQuestion,
  matchConcept,
  answerQuestion,
  answerFromFiles,
  buildReasonedAnswer,
  directConclusionFor
};
