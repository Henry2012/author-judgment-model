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

function classifyQuestion(question, config, profile) {
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
  return Array.from(
    new Set([...(domainConfig.priority_keywords || []), ...(domainConfig.keywords || []), ...(domainConfig.variables || [])].map(cleanText))
  ).filter((term) => term && text.includes(term));
}

function evidenceMatchScore(unit, terms) {
  const text = cleanText([unit.claim, unit.evidence_excerpt, unit.object, ...(unit.variables || [])].join(" "));
  return terms.reduce((score, term) => score + (text.includes(term) ? Math.max(1, term.length) : 0), 0);
}

function buildEvidenceTrace(model, units, options = {}) {
  const unitById = new Map(units.map((unit) => [unit.unit_id, unit]));
  const terms = evidenceTermsFor(options.question || "", options.config || {}, options.domain || "");
  return (model?.evidence_unit_ids || [])
    .map((unitId) => unitById.get(unitId))
    .filter(Boolean)
    .map((unit, index) => ({ unit, index, score: evidenceMatchScore(unit, terms) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
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

function directConclusionFor({ question, domain, variables, config }) {
  const text = cleanText(question);
  const domainLabel = labelDomain(domain, config);
  const variableText = labelVariables(variables).join("、") || "语料支持的核心变量";

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

function buildReasonedAnswer({ question, domain, model, variables, evidenceTrace, confidence, boundaries, config }) {
  const variableText = labelVariables(variables).join("、") || "语料支持的核心变量";
  const evidenceText = evidenceTrace
    .slice(0, 3)
    .map((item) => `${item.unit_id}（${item.created_at || "日期未知"}）`)
    .join("、");
  const boundaryText = localizeBoundaries(boundaries).slice(0, 2).join(" ");

  return [
    `直接回答：${directConclusionFor({ question, domain, variables, config })}`,
    `可能的判断逻辑：${localizedModelSummary({ domain, variables, config })}`,
    evidenceText ? `证据链：${evidenceText}。` : "证据链：未找到可引用的证据单元。",
    `置信度：${labelConfidence(confidence)}。边界：${boundaryText}`
  ].join("\n");
}

function answerQuestion({ question, profile, units, config }) {
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
    direct_answer: directConclusionFor({ question, domain, variables, config }),
    reasoned_answer: buildReasonedAnswer({
      question,
      domain,
      model,
      variables,
      evidenceTrace,
      confidence,
      boundaries,
      config
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
  answerQuestion,
  answerFromFiles,
  buildReasonedAnswer,
  directConclusionFor
};
