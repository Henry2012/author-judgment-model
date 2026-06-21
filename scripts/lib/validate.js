const fs = require("fs");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function countBy(items, keyFn) {
  return items.reduce((acc, item) => {
    const key = keyFn(item);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function compactText(value) {
  return String(value || "").replace(/\s+/g, "");
}

function excerptIsGrounded(unit, post) {
  if (!hasText(unit.evidence_excerpt) || !post) return true;
  const excerpt = compactText(unit.evidence_excerpt);
  const source = compactText(`${post.text || ""}${post.context_text || ""}`);
  return excerpt.length > 0 && source.includes(excerpt);
}

function validateArtifacts({ posts, units, evidenceMaps, profile }) {
  const errors = [];
  const warnings = [];
  const postIds = new Set(posts.map((post) => post.post_id));
  const postById = new Map(posts.map((post) => [post.post_id, post]));
  const unitIds = new Set(units.map((unit) => unit.unit_id));

  if (!Array.isArray(posts) || posts.length === 0) errors.push("normalized posts are empty");
  if (!Array.isArray(units) || units.length === 0) errors.push("judgment units are empty");
  if (!Array.isArray(evidenceMaps) || evidenceMaps.length === 0) errors.push("evidence maps are empty");
  if (!profile || typeof profile !== "object") errors.push("profile is missing or invalid");

  for (const field of ["profile_id", "platform", "author_id", "coverage_summary", "domain_map"]) {
    if (!profile?.[field]) errors.push(`profile missing ${field}`);
  }

  for (const unit of units) {
    if (!hasText(unit.unit_id)) errors.push("judgment unit missing unit_id");
    if (!hasText(unit.source_post_id)) errors.push(`${unit.unit_id || "unknown unit"} missing source_post_id`);
    if (unit.source_post_id && !postIds.has(unit.source_post_id)) {
      errors.push(`${unit.unit_id} references missing post ${unit.source_post_id}`);
    }
    if (!hasText(unit.claim)) errors.push(`${unit.unit_id || "unknown unit"} missing claim`);
    if (!hasText(unit.domain)) errors.push(`${unit.unit_id || "unknown unit"} missing domain`);
    if (!Array.isArray(unit.variables)) errors.push(`${unit.unit_id || "unknown unit"} variables must be an array`);
    if (!hasText(unit.evidence_excerpt)) warnings.push(`${unit.unit_id || "unknown unit"} has no evidence excerpt`);
    if (hasText(unit.evidence_excerpt) && unit.source_post_id && postById.has(unit.source_post_id)) {
      if (!excerptIsGrounded(unit, postById.get(unit.source_post_id))) {
        errors.push(`${unit.unit_id || "unknown unit"} evidence_excerpt is not grounded in source post ${unit.source_post_id}`);
      }
    }
  }

  for (const map of evidenceMaps) {
    if (!hasText(map.domain)) errors.push("evidence map missing domain");
    if (!Array.isArray(map.supporting_units) || map.supporting_units.length === 0) {
      errors.push(`evidence map ${map.domain || "unknown"} has no supporting units`);
    }
    for (const unitId of map.supporting_units || []) {
      if (!unitIds.has(unitId)) errors.push(`evidence map ${map.domain} references missing unit ${unitId}`);
    }
    if (!Array.isArray(map.key_variables) || map.key_variables.length === 0) {
      warnings.push(`evidence map ${map.domain || "unknown"} has no key variables`);
    }
  }

  for (const model of profile?.mental_models || []) {
    if (!Array.isArray(model.evidence_unit_ids) || model.evidence_unit_ids.length === 0) {
      errors.push(`mental model ${model.id || "unknown"} has no evidence units`);
    }
    for (const unitId of model.evidence_unit_ids || []) {
      if (!unitIds.has(unitId)) errors.push(`mental model ${model.id} references missing unit ${unitId}`);
    }
    if (!Array.isArray(model.limitations) || model.limitations.length === 0) {
      warnings.push(`mental model ${model.id || "unknown"} has no limitations`);
    }
  }

  if (!Array.isArray(profile?.decision_heuristics) || profile.decision_heuristics.length === 0) {
    errors.push("profile has no decision heuristics");
  }
  if (!Array.isArray(profile?.honest_boundaries) || profile.honest_boundaries.length === 0) {
    errors.push("profile has no honest boundaries");
  }
  if (!Array.isArray(profile?.evidence_map_refs) || profile.evidence_map_refs.length === 0) {
    errors.push("profile has no evidence map refs");
  }

  const unitDomains = countBy(units, (unit) => unit.domain || "unknown");
  const supportedDomains = Object.keys(unitDomains).filter((domain) => domain !== "general");
  if (supportedDomains.length === 0) errors.push("no non-general domains were extracted");

  const report = {
    status: errors.length === 0 ? "pass" : "fail",
    profile_id: profile?.profile_id || "",
    platform: profile?.platform || "",
    author_id: profile?.author_id || "",
    counts: {
      posts: posts.length,
      judgment_units: units.length,
      evidence_maps: evidenceMaps.length,
      mental_models: profile?.mental_models?.length || 0,
      decision_heuristics: profile?.decision_heuristics?.length || 0,
      anti_patterns: profile?.anti_patterns?.length || 0
    },
    domains: unitDomains,
    errors,
    warnings
  };

  return report;
}

function validateArtifactsFromFiles(options) {
  return validateArtifacts({
    posts: readJson(options.postsPath),
    units: readJson(options.unitsPath),
    evidenceMaps: readJson(options.evidenceMapsPath),
    profile: readJson(options.profilePath)
  });
}

module.exports = {
  validateArtifacts,
  validateArtifactsFromFiles,
  excerptIsGrounded
};
