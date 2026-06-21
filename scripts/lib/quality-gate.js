const fs = require("fs");
const path = require("path");
const { buildReviewReport } = require("./report");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function defaultThresholds(overrides = {}) {
  return {
    minPosts: Number(overrides.minPosts || 50),
    minJudgmentUnits: Number(overrides.minJudgmentUnits || 50),
    minMentalModels: Number(overrides.minMentalModels || 3),
    warnGeneralUnitRatio: Number(overrides.warnGeneralUnitRatio || 0.35),
    failGeneralUnitRatio: Number(overrides.failGeneralUnitRatio || 0.8),
    warnLowConfidenceUnitRatio: Number(overrides.warnLowConfidenceUnitRatio || 0.6)
  };
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function qualityMetrics({ posts, units, profile }) {
  const generalUnits = units.filter((unit) => unit.domain === "general").length;
  const lowConfidenceUnits = units.filter((unit) => unit.confidence === "low" || unit.evidence_strength === "weak").length;
  const discoveredDomains = Object.keys(profile.domain_map || {}).filter((domain) => domain.startsWith("discovered_")).length;
  return {
    posts: posts.length,
    judgment_units: units.length,
    mental_models: (profile.mental_models || []).length,
    validation_results: (profile.validation_results || []).length,
    general_unit_ratio: ratio(generalUnits, units.length),
    low_confidence_unit_ratio: ratio(lowConfidenceUnits, units.length),
    discovered_domains: discoveredDomains
  };
}

function pushUnique(list, code) {
  if (!list.includes(code)) list.push(code);
}

function scoreGate(blockingIssues, warnings) {
  const score = 100 - blockingIssues.length * 45 - warnings.length * 8;
  return Math.max(0, Math.min(100, score));
}

function recommendationsFor({ blockingIssues, warnings }) {
  const recommendations = [];
  if (blockingIssues.includes("artifact_validation_failed")) {
    recommendations.push("Fix artifact validation errors before packaging or answering.");
  }
  if (blockingIssues.includes("general_unit_ratio_too_high")) {
    recommendations.push("Review or regenerate the author config; too many units are classified as general.");
  }
  if (warnings.includes("small_corpus")) {
    recommendations.push("Collect more posts before serious use, or mark the package as low coverage.");
  }
  if (warnings.includes("low_judgment_unit_count")) {
    recommendations.push("Run LLM extraction or broaden the config to extract more judgment units.");
  }
  if (warnings.includes("fewer_than_three_mental_models")) {
    recommendations.push("Review whether the corpus has enough recurring models, or keep the package in exploratory mode.");
  }
  if (warnings.includes("validation_results_not_embedded_in_profile")) {
    recommendations.push("Add and persist validation cases for the top domains.");
  }
  if (warnings.includes("high_general_unit_ratio")) {
    recommendations.push("Inspect domain keywords and reduce noisy general classifications.");
  }
  if (warnings.includes("high_low_confidence_unit_ratio")) {
    recommendations.push("Review weak or low-confidence units; consider LLM extraction or stricter domain config before serious use.");
  }
  if (warnings.includes("suggested_config_needs_review")) {
    recommendations.push("Rename discovered domains and variables before serious use.");
  }
  if (!recommendations.length) {
    recommendations.push("Quality gate passed; proceed to review pack or package usage.");
  }
  return recommendations;
}

function evaluateQualityGate({ posts, units, evidenceMaps, profile, thresholds = {} }) {
  const gateThresholds = defaultThresholds(thresholds);
  const report = buildReviewReport({ posts, units, evidenceMaps, profile });
  const metrics = qualityMetrics({ posts, units, profile });
  const blockingIssues = [];
  const warnings = [];

  if (report.validation.status !== "pass") pushUnique(blockingIssues, "artifact_validation_failed");
  if (metrics.general_unit_ratio >= gateThresholds.failGeneralUnitRatio) {
    pushUnique(blockingIssues, "general_unit_ratio_too_high");
  }

  for (const risk of report.risks || []) {
    if (risk === "artifact_validation_failed") continue;
    pushUnique(warnings, risk);
  }
  if (metrics.posts < gateThresholds.minPosts) pushUnique(warnings, "small_corpus");
  if (metrics.judgment_units < gateThresholds.minJudgmentUnits) pushUnique(warnings, "low_judgment_unit_count");
  if (metrics.mental_models < gateThresholds.minMentalModels) pushUnique(warnings, "fewer_than_three_mental_models");
  if (metrics.general_unit_ratio >= gateThresholds.warnGeneralUnitRatio && metrics.general_unit_ratio < gateThresholds.failGeneralUnitRatio) {
    pushUnique(warnings, "high_general_unit_ratio");
  }
  if (metrics.low_confidence_unit_ratio >= gateThresholds.warnLowConfidenceUnitRatio) {
    pushUnique(warnings, "high_low_confidence_unit_ratio");
  }
  if (metrics.discovered_domains > 0) pushUnique(warnings, "suggested_config_needs_review");

  const score = scoreGate(blockingIssues, warnings);
  const status = blockingIssues.length ? "fail" : warnings.length ? "warn" : "pass";

  return {
    status,
    score,
    profile_id: report.profile_id,
    blocking_issues: blockingIssues,
    warnings,
    metrics,
    thresholds: gateThresholds,
    validation: report.validation,
    recommendations: recommendationsFor({ blockingIssues, warnings })
  };
}

function evaluateQualityGateFromFiles(options) {
  const gate = evaluateQualityGate({
    posts: readJson(options.postsPath),
    units: readJson(options.unitsPath),
    evidenceMaps: readJson(options.evidenceMapsPath),
    profile: readJson(options.profilePath),
    thresholds: options.thresholds || options
  });
  if (options.outPath) writeJson(options.outPath, gate);
  return gate;
}

module.exports = {
  evaluateQualityGate,
  evaluateQualityGateFromFiles,
  qualityMetrics,
  defaultThresholds
};
