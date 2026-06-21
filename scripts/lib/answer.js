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

function buildEvidenceTrace(model, units) {
  const unitById = new Map(units.map((unit) => [unit.unit_id, unit]));
  return (model?.evidence_unit_ids || [])
    .map((unitId) => unitById.get(unitId))
    .filter(Boolean)
    .slice(0, 5)
    .map((unit) => ({
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

function buildReasonedAnswer({ question, domain, model, variables, evidenceTrace, confidence, boundaries, config }) {
  const variableText = labelVariables(variables).join("、") || "语料支持的核心变量";
  const evidenceText = evidenceTrace
    .slice(0, 3)
    .map((item) => `${item.unit_id}（${item.created_at || "日期未知"}）`)
    .join("、");
  const boundaryText = localizeBoundaries(boundaries).slice(0, 2).join(" ");

  return [
    `直接回答：对于「${question}」，应先放入「${labelDomain(domain, config)}」判断域，并优先检查${variableText}。`,
    `可能的判断逻辑：${localizedModelSummary({ domain, variables, config })}`,
    evidenceText ? `证据链：${evidenceText}。` : "证据链：未找到可引用的证据单元。",
    `置信度：${labelConfidence(confidence)}。边界：${boundaryText}`
  ].join("\n");
}

function answerQuestion({ question, profile, units, config }) {
  const domain = classifyQuestion(question, config, profile);
  const model = findModel(profile, domain);
  const heuristic = findHeuristic(profile, domain);
  const evidenceTrace = buildEvidenceTrace(model, units);
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
    direct_answer: `使用该作者的「${labelDomain(domain, config)}」判断模型时，应通过${variableText}来评估这个问题。`,
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
  buildReasonedAnswer
};
