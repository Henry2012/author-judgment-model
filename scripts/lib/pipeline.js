const fs = require("fs");
const path = require("path");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function truncate(value, max = 220) {
  const text = cleanText(value);
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function sourceExcerpt(value, max = 260) {
  return cleanText(value).slice(0, max);
}

function inferAuthorId(raw, row, explicitAuthorId) {
  if (explicitAuthorId) return String(explicitAuthorId);
  const target = String(raw.target || row.capture_url || row.url || "");
  const match = target.match(/(?:\/u\/|weibo\.com\/)(\d+)/);
  return match ? match[1] : "unknown-author";
}

function normalizeDate(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return text;
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
  if (match) {
    return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:00+08:00`;
  }
  return text;
}

function normalizeWeiboRaw(raw, options = {}) {
  const rows = Array.isArray(raw.rows) ? raw.rows : [];
  const seen = new Set();
  const posts = [];

  for (const row of rows) {
    const postId = String(row.id || row.bid || row.post_id || "").trim();
    const text = cleanText(row.text);
    if (!postId || !text || seen.has(postId)) continue;
    seen.add(postId);

    const authorId = inferAuthorId(raw, row, options.authorId);
    posts.push({
      platform: "weibo",
      author_id: authorId,
      author_handle: options.authorHandle || raw.author_handle || raw.account || "",
      post_id: postId,
      created_at: normalizeDate(row.created_at),
      text,
      post_type: row.retweeted_text || row.context_text ? "repost" : "original",
      context_text: cleanText(row.retweeted_text || row.context_text || ""),
      url: row.url || (authorId !== "unknown-author" ? `https://weibo.com/${authorId}/${postId}` : ""),
      engagement: {
        likes: Number(row.attitudes_count || row.likes || 0),
        comments: Number(row.comments_count || row.comments || 0),
        reposts: Number(row.reposts_count || row.reposts || 0)
      },
      capture: {
        captured_at: row.captured_at || raw.collectedAt || new Date().toISOString(),
        method: row.capture_method || raw.capture_method || "unknown",
        capture_url: row.capture_url || raw.target || "",
        coverage_note: raw.coverage_note || ""
      }
    });
  }

  return posts.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
}

function scoreDomain(post, domain) {
  const haystack = `${post.text} ${post.context_text}`;
  return domain.keywords.reduce((score, keyword) => score + (haystack.includes(keyword) ? 1 : 0), 0);
}

function classifyDomains(post, config) {
  const matches = Object.entries(config.domains)
    .map(([domainId, domain]) => ({ domainId, score: scoreDomain(post, domain) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return matches.length ? matches.slice(0, 2) : [{ domainId: "general", score: 0 }];
}

function detectAntiPatterns(text, config) {
  return Object.entries(config.anti_pattern_keywords || {})
    .filter(([, keywords]) => keywords.some((keyword) => text.includes(keyword)))
    .map(([id]) => id);
}

function extractJudgmentUnits(posts, config) {
  const units = [];
  let counter = 1;

  for (const post of posts) {
    const domains = classifyDomains(post, config);
    const antiPatterns = detectAntiPatterns(`${post.text} ${post.context_text}`, config);

    for (const match of domains) {
      const domain = config.domains[match.domainId] || {
        name: "General judgment",
        variables: [],
        model_template: "General author judgment extracted from the source corpus."
      };
      const evidenceStrength = match.score >= 2 ? "direct" : match.score === 1 ? "indirect" : "weak";
      const confidence = evidenceStrength === "direct" ? "medium" : "low";

      units.push({
        unit_id: `unit_${String(counter).padStart(6, "0")}`,
        source_post_id: post.post_id,
        created_at: post.created_at,
        domain: match.domainId,
        claim: truncate(post.text, 180),
        object: domain.name,
        stance: "candidate_judgment",
        variables: domain.variables || [],
        causal_chain: [],
        decision_rule: "",
        anti_patterns: antiPatterns,
        confidence,
        evidence_strength: evidenceStrength,
        evidence_excerpt: sourceExcerpt(post.text, 260),
        source_url: post.url
      });
      counter += 1;
    }
  }

  return units;
}

function groupBy(items, keyFn) {
  return items.reduce((acc, item) => {
    const key = keyFn(item);
    acc[key] = acc[key] || [];
    acc[key].push(item);
    return acc;
  }, {});
}

function topValues(items, valueFn, limit = 5) {
  const counts = new Map();
  for (const item of items) {
    const values = valueFn(item);
    for (const value of Array.isArray(values) ? values : [values]) {
      const key = cleanText(value);
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value]) => value);
}

function strongestUnits(units, limit = 20) {
  return [...units].sort((a, b) => confidenceRank(b) - confidenceRank(a)).slice(0, limit);
}

function synthesizeCoreJudgment(domainId, domainUnits, domainConfig = {}) {
  const decisionRules = topValues(domainUnits, (unit) => unit.decision_rule, 2);
  const claims = strongestUnits(domainUnits, 3).map((unit) => unit.claim).filter(Boolean);
  const variables = topValues(domainUnits, (unit) => unit.variables || [], 5);
  const causalSteps = topValues(domainUnits, (unit) => unit.causal_chain || [], 4);

  if (decisionRules.length) {
    const parts = [`Recurring decision rule: ${decisionRules[0]}`];
    if (variables.length) parts.push(`Priority variables: ${variables.join(", ")}.`);
    if (causalSteps.length) parts.push(`Common causal chain elements: ${causalSteps.join(" -> ")}.`);
    return parts.join(" ");
  }

  if (claims.length && variables.length) {
    return `Recurring ${domainId} judgment emphasizes ${variables.join(", ")}. Representative claim: ${claims[0]}`;
  }

  return domainConfig.model_template || `General ${domainId} judgment extracted from recurring evidence units.`;
}

function buildEvidenceMaps(units, config) {
  const byDomain = groupBy(units, (unit) => unit.domain);
  return Object.entries(byDomain)
    .filter(([domain]) => domain !== "general")
    .map(([domainId, domainUnits]) => {
      const domain = config.domains[domainId] || {};
      const supportingUnits = strongestUnits(domainUnits, 20).map((unit) => unit.unit_id);
      const keyVariables = topValues(domainUnits, (unit) => unit.variables || [], 8);
      return {
        domain: domainId,
        core_judgment: synthesizeCoreJudgment(domainId, domainUnits, domain),
        supporting_units: supportingUnits,
        conflicting_units: [],
        key_variables: keyVariables.length ? keyVariables : domain.variables || [],
        boundary: [
          "This is a corpus-backed judgment approximation, not a claim about the author's future personal view.",
          "Real-time factual claims require external verification before applying this judgment model."
        ],
        confidence: domainUnits.length >= 20 ? "high" : domainUnits.length >= 5 ? "medium" : "low"
      };
    });
}

function confidenceRank(unit) {
  const evidence = { direct: 3, indirect: 2, weak: 1 }[unit.evidence_strength] || 0;
  return evidence + Math.min(2, unit.variables.length / 10);
}

function coverageSummary(posts, raw) {
  const dates = posts
    .map((post) => post.created_at)
    .filter((value) => /^\d{4}-\d{2}-\d{2}/.test(String(value || "")))
    .sort();
  return {
    collected_at: raw.collectedAt || "",
    rows: posts.length,
    first_created_at: dates[0] || "",
    last_created_at: dates[dates.length - 1] || "",
    source_target: raw.target || "",
    limitation: raw.coverage_note || "Coverage depends on the supplied Weibo raw corpus."
  };
}

function buildProfile(posts, units, evidenceMaps, config, options = {}, raw = {}) {
  const byDomain = groupBy(units, (unit) => unit.domain);
  const profileId = `weibo-${options.authorId || posts[0]?.author_id || "unknown-author"}`;
  const domainMap = Object.fromEntries(
    Object.entries(byDomain).map(([domainId, domainUnits]) => [
      domainId,
      {
        unit_count: domainUnits.length,
        evidence_strength: domainUnits.some((unit) => unit.evidence_strength === "direct") ? "direct" : "indirect"
      }
    ])
  );

  const mentalModels = evidenceMaps.map((map) => ({
    id: `model_${map.domain}`,
    name: config.domains[map.domain]?.name || map.domain,
    definition: map.core_judgment,
    domains: [map.domain],
    variables: map.key_variables,
    evidence_unit_ids: map.supporting_units.slice(0, 8),
    limitations: map.boundary
  }));

  const decisionHeuristics = evidenceMaps.map((map) => ({
    id: `heuristic_${map.domain}`,
    trigger: `Question is classified as ${map.domain}.`,
    priority_variables: map.key_variables,
    default_action:
      topValues(byDomain[map.domain] || [], (unit) => unit.decision_rule, 1)[0] ||
      "Apply the evidence-backed model, then state boundaries and confidence.",
    boundary: "Do not infer unsupported real-time facts or personal authorization."
  }));

  const antiPatterns = Array.from(new Set(units.flatMap((unit) => unit.anti_patterns))).map((id) => ({
    id,
    evidence_unit_ids: units.filter((unit) => unit.anti_patterns.includes(id)).slice(0, 8).map((unit) => unit.unit_id)
  }));

  const concepts = (config.concepts || []).map((concept) => {
    const aliases = Array.isArray(concept.aliases) ? concept.aliases : [];
    const domains = Array.isArray(concept.domains) ? concept.domains : [];
    const evidenceUnits = units
      .filter((unit) => {
        const text = cleanText([unit.claim, unit.evidence_excerpt, unit.object, ...(unit.variables || [])].join(" "));
        return domains.includes(unit.domain) && aliases.some((alias) => alias && text.includes(alias));
      })
      .sort((a, b) => confidenceRank(b) - confidenceRank(a))
      .slice(0, 12)
      .map((unit) => unit.unit_id);
    return {
      id: concept.id,
      name: concept.name || concept.id,
      aliases,
      domains,
      trigger_conditions: concept.trigger_conditions || [],
      required_variables: concept.required_variables || [],
      boundary_conditions: concept.boundary_conditions || [],
      counterexamples: concept.counterexamples || [],
      time_scope: concept.time_scope || "",
      evidence_unit_ids: evidenceUnits
    };
  });

  return {
    profile_id: profileId,
    platform: "weibo",
    author_id: options.authorId || posts[0]?.author_id || "unknown-author",
    author_handle: options.authorHandle || posts[0]?.author_handle || "",
    coverage_summary: coverageSummary(posts, raw),
    domain_map: domainMap,
    mental_models: mentalModels,
    concepts,
    decision_heuristics: decisionHeuristics,
    anti_patterns: antiPatterns,
    honest_boundaries: [
      "The profile is derived from the supplied Weibo corpus only.",
      "The model must not imitate tone, catchphrases, emoji habits, or persona.",
      "Unsupported topics should be answered with low confidence or refused."
    ],
    evidence_map_refs: evidenceMaps.map((map) => `evidence-maps/${map.domain}.json`),
    validation_results: [],
    update_history: [
      {
        updated_at: new Date().toISOString(),
        event: "profile_built",
        source_rows: posts.length,
        judgment_units: units.length
      }
    ]
  };
}

function validatePipelineArtifacts({ posts, units, evidenceMaps, profile }) {
  const errors = [];
  if (!posts.length) errors.push("No normalized posts were produced.");
  if (!units.length) errors.push("No judgment units were produced.");
  if (!evidenceMaps.length) errors.push("No evidence maps were produced.");
  if (!profile.profile_id) errors.push("Profile is missing profile_id.");
  for (const unit of units) {
    if (!unit.source_post_id || !unit.claim || !unit.domain) {
      errors.push(`Invalid judgment unit: ${unit.unit_id || "unknown"}`);
    }
  }
  return errors;
}

function runPipeline(options) {
  const configPath = options.configPath || path.join(process.cwd(), "configs/weibo.default.json");
  const config = readJson(configPath);
  const raw = readJson(options.rawPath);
  const posts = normalizeWeiboRaw(raw, options);
  const units = extractJudgmentUnits(posts, config);
  const evidenceMaps = buildEvidenceMaps(units, config);
  const profile = buildProfile(posts, units, evidenceMaps, config, options, raw);
  const errors = validatePipelineArtifacts({ posts, units, evidenceMaps, profile });
  if (errors.length) {
    const err = new Error(`AJM pipeline validation failed:\n${errors.join("\n")}`);
    err.errors = errors;
    throw err;
  }

  const outRoot = options.outDir || path.join(process.cwd(), "data");
  const slug = profile.profile_id;
  writeJson(path.join(outRoot, "normalized", slug, "posts.json"), posts);
  writeJson(path.join(outRoot, "judgment-units", slug, "judgment-units.json"), units);
  writeJson(path.join(outRoot, "evidence-maps", slug, "evidence-maps.json"), evidenceMaps);
  writeJson(path.join(outRoot, "profiles", slug, "author-judgment-profile.json"), profile);

  return {
    slug,
    posts: posts.length,
    units: units.length,
    evidenceMaps: evidenceMaps.length,
    profilePath: path.join(outRoot, "profiles", slug, "author-judgment-profile.json")
  };
}

function buildArtifactsFromUnits(options) {
  const configPath = options.configPath || path.join(process.cwd(), "configs/weibo.default.json");
  const config = readJson(configPath);
  const posts = readJson(options.postsPath);
  const units = readJson(options.unitsPath);
  const evidenceMaps = buildEvidenceMaps(units, config);
  const raw = {
    collectedAt: options.collectedAt || "",
    target: options.sourceTarget || posts[0]?.capture?.capture_url || ""
  };
  const profile = buildProfile(posts, units, evidenceMaps, config, options, raw);
  const errors = validatePipelineArtifacts({ posts, units, evidenceMaps, profile });
  if (errors.length) {
    const err = new Error(`AJM rebuild validation failed:\n${errors.join("\n")}`);
    err.errors = errors;
    throw err;
  }

  const outRoot = options.outDir || path.join(process.cwd(), "data");
  const slug = profile.profile_id;
  writeJson(path.join(outRoot, "evidence-maps", slug, "evidence-maps.json"), evidenceMaps);
  writeJson(path.join(outRoot, "profiles", slug, "author-judgment-profile.json"), profile);

  return {
    slug,
    posts: posts.length,
    units: units.length,
    evidenceMaps: evidenceMaps.length,
    profilePath: path.join(outRoot, "profiles", slug, "author-judgment-profile.json"),
    evidenceMapsPath: path.join(outRoot, "evidence-maps", slug, "evidence-maps.json")
  };
}

module.exports = {
  normalizeWeiboRaw,
  extractJudgmentUnits,
  buildEvidenceMaps,
  buildProfile,
  synthesizeCoreJudgment,
  validatePipelineArtifacts,
  runPipeline,
  buildArtifactsFromUnits
};
