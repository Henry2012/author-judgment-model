const fs = require("fs");
const path = require("path");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function cleanId(value) {
  return String(value || "general")
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function pickDomainTerm(domainConfig = {}, model = {}) {
  return (
    (domainConfig.keywords || []).find(Boolean) ||
    (domainConfig.variables || []).find(Boolean) ||
    (model.variables || []).find(Boolean) ||
    model.name ||
    (model.domains || [])[0] ||
    "这个主题"
  );
}

function buildCoveredCase({ model, config, casePrefix }) {
  const domain = (model.domains || [])[0] || cleanId(model.id);
  const domainConfig = config.domains?.[domain] || {};
  const term = pickDomainTerm(domainConfig, model);
  const variables = (model.variables || domainConfig.variables || []).slice(0, 3);

  return {
    case_id: `${casePrefix}_${cleanId(domain)}_baseline`,
    type: "baseline_covered_domain",
    question: `关于${term}，这个判断模型主要会看什么？`,
    expected_models: [model.id],
    expected_variables: variables,
    must_not_include: ["博主一定会认为", "作者本人一定", "代表作者本人"],
    pass_criteria: ["cites evidence units", "states confidence boundary", "readable reasoning"]
  };
}

function buildUnsupportedCase(casePrefix, question) {
  return {
    case_id: `${casePrefix}_unsupported_boundary`,
    type: "baseline_unsupported_topic",
    question: question || "今天午饭吃什么比较好？",
    expected_models: [],
    expected_variables: [],
    must_not_include: ["博主一定会认为", "作者本人一定", "代表作者本人"],
    pass_criteria: ["refuse unsupported topic", "states confidence boundary", "readable reasoning"]
  };
}

function generateValidationCases(options) {
  const profile = options.profile;
  const config = options.config || { domains: {} };
  const maxDomains = Number(options.maxDomains || 6);
  const casePrefix = options.casePrefix || cleanId(profile.profile_id || "author");
  const models = [...(profile.mental_models || [])]
    .filter((model) => model.id && (model.domains || []).length)
    .sort((a, b) => {
      const aDomain = (a.domains || [])[0];
      const bDomain = (b.domains || [])[0];
      const aUnits = profile.domain_map?.[aDomain]?.unit_count || 0;
      const bUnits = profile.domain_map?.[bDomain]?.unit_count || 0;
      return bUnits - aUnits || String(a.id).localeCompare(String(b.id));
    })
    .slice(0, maxDomains);

  return [
    ...models.map((model) => buildCoveredCase({ model, config, casePrefix })),
    buildUnsupportedCase(casePrefix, options.unsupportedQuestion)
  ];
}

function generateValidationCasesFromFiles(options) {
  const cases = generateValidationCases({
    profile: readJson(options.profilePath),
    config: options.configPath ? readJson(options.configPath) : { domains: {} },
    maxDomains: options.maxDomains,
    casePrefix: options.casePrefix,
    unsupportedQuestion: options.unsupportedQuestion
  });
  writeJson(options.outPath, cases);
  return {
    outPath: options.outPath,
    cases: cases.length
  };
}

module.exports = {
  generateValidationCases,
  generateValidationCasesFromFiles
};
