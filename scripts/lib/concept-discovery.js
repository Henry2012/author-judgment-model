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

function discoverConceptCandidates({ units, minEvidenceUnits = 3, maxCandidates = 30 } = {}) {
  const options = { minEvidenceUnits };
  const candidates = dedupeCandidates(buildGroups(units).map((group) => buildConceptCandidate(group, options))).slice(0, maxCandidates);
  return {
    version: "0.2.1",
    generated_at: new Date().toISOString(),
    quality_gate: {
      min_evidence_units: Number(minEvidenceUnits),
      pass: candidates.filter((candidate) => candidate.quality.status === "pass").length,
      fail: candidates.filter((candidate) => candidate.quality.status !== "pass").length
    },
    candidates
  };
}

function reviewTemplateFor(candidates) {
  return {
    version: "0.2.1",
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

function exportConceptReviewPack({ candidates, outDir }) {
  const resolvedOutDir = path.resolve(outDir);
  const candidatesPath = path.join(resolvedOutDir, "concept-candidates.json");
  const reviewTemplatePath = path.join(resolvedOutDir, "concept-review-template.json");
  const reviewMarkdownPath = path.join(resolvedOutDir, "concept-review.md");
  writeJson(candidatesPath, { version: "0.2.1", candidates });
  writeJson(reviewTemplatePath, reviewTemplateFor(candidates));
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
    maxCandidates: options.maxCandidates
  });
  const exported = exportConceptReviewPack({
    candidates: result.candidates,
    outDir: options.outDir
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
