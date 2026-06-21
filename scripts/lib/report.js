const fs = require("fs");
const { validateArtifacts } = require("./validate");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function topEvidenceUnits(units, unitIds, limit = 5) {
  const byId = new Map(units.map((unit) => [unit.unit_id, unit]));
  return (unitIds || [])
    .map((unitId) => byId.get(unitId))
    .filter(Boolean)
    .slice(0, limit)
    .map((unit) => ({
      unit_id: unit.unit_id,
      source_post_id: unit.source_post_id,
      created_at: unit.created_at,
      claim: unit.claim,
      evidence_excerpt: unit.evidence_excerpt,
      source_url: unit.source_url
    }));
}

function buildRisks({ profile, validationReport }) {
  const risks = [];
  if (validationReport.status !== "pass") {
    risks.push("artifact_validation_failed");
  }
  if (!profile.coverage_summary?.first_created_at || !profile.coverage_summary?.last_created_at) {
    risks.push("coverage_window_missing");
  }
  if ((profile.mental_models || []).length < 3) {
    risks.push("fewer_than_three_mental_models");
  }
  if (!(profile.honest_boundaries || []).length) {
    risks.push("honest_boundaries_missing");
  }
  if ((profile.validation_results || []).length === 0) {
    risks.push("validation_results_not_embedded_in_profile");
  }
  return risks;
}

function buildReviewReport({ posts, units, evidenceMaps, profile }) {
  const validationReport = validateArtifacts({ posts, units, evidenceMaps, profile });
  const domains = evidenceMaps.map((map) => ({
    domain: map.domain,
    unit_count: profile.domain_map?.[map.domain]?.unit_count || 0,
    confidence: map.confidence,
    key_variables: map.key_variables || [],
    core_judgment: map.core_judgment,
    top_evidence_units: topEvidenceUnits(units, map.supporting_units, 5)
  }));

  return {
    profile_id: profile.profile_id,
    platform: profile.platform,
    author_id: profile.author_id,
    author_handle: profile.author_handle || "",
    coverage: profile.coverage_summary,
    counts: {
      posts: posts.length,
      judgment_units: units.length,
      evidence_maps: evidenceMaps.length,
      mental_models: (profile.mental_models || []).length,
      decision_heuristics: (profile.decision_heuristics || []).length,
      anti_patterns: (profile.anti_patterns || []).length
    },
    domains,
    validation: {
      status: validationReport.status,
      errors: validationReport.errors,
      warnings: validationReport.warnings
    },
    risks: buildRisks({ profile, validationReport }),
    recommended_next_actions: validationReport.status === "pass"
      ? ["Run validation cases for known author stances.", "Review top evidence units for each high-impact domain."]
      : ["Fix artifact validation errors before using this profile."]
  };
}

function buildReviewReportFromFiles(options) {
  return buildReviewReport({
    posts: readJson(options.postsPath),
    units: readJson(options.unitsPath),
    evidenceMaps: readJson(options.evidenceMapsPath),
    profile: readJson(options.profilePath)
  });
}

module.exports = {
  buildReviewReport,
  buildReviewReportFromFiles
};
