const fs = require("fs");
const path = require("path");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${value.replace(/\s+$/u, "")}\n`);
}

function writeJson(filePath, value) {
  writeFile(filePath, JSON.stringify(value, null, 2));
}

function copyJson(fromPath, toPath) {
  writeJson(toPath, readJson(fromPath));
}

function topDomains(profile, limit = 8) {
  return Object.entries(profile.domain_map || {})
    .sort(([, a], [, b]) => (b.unit_count || 0) - (a.unit_count || 0))
    .slice(0, limit)
    .map(([domain, info]) => `${domain} (${info.unit_count || 0} units)`);
}

function buildAgentPrompt(profile) {
  const models = (profile.mental_models || [])
    .slice(0, 8)
    .map((model) => `- ${model.id}: ${model.definition}`)
    .join("\n");
  const boundaries = (profile.honest_boundaries || [])
    .map((boundary) => `- ${boundary}`)
    .join("\n");

  return [
    `# AJM Agent Prompt: ${profile.profile_id}`,
    "",
    "你正在使用一个 Author Judgment Model package。必须用中文回答用户问题，用证据约束的判断逻辑，而不是模仿作者本人。",
    "",
    "硬性语言规则：最终回答只能使用中文。内部字段名、证据单元 id、来源链接可以保留原样，但面向用户的解释、变量名、置信度、边界说明都必须中文化。",
    "",
    "不要模仿作者的语气、人设、口头禅、标点、情绪或身份。不要扮演作者。",
    "",
    "回答要求：",
    "- 先给出直接回答。",
    "- 对实时、未来、市场、价格、政策、财报、行情类问题，必须先使用用户提供的事实/事件/数据上下文；如果没有上下文，只能输出判断框架，并明确说不能形成最终答案。",
    "- 如果 profile.concepts 命中问题，先说明匹配到的概念、触发条件、边界条件和反例，再进入判断模型。",
    "- 解释可能使用的判断模型和关键变量，变量名要转成中文。",
    "- 给出证据链，可包含 unit id 或 source post id。",
    "- 说明置信度和边界，置信度必须写成高/中/低。",
    "- 当语料不支持该主题时，拒答或降低置信度。",
    "",
    `Profile id: ${profile.profile_id}`,
    `Platform: ${profile.platform}`,
    `Author id: ${profile.author_id}`,
    `Coverage: ${profile.coverage_summary?.first_created_at || "unknown"} to ${profile.coverage_summary?.last_created_at || "unknown"}`,
    "",
    "Top domains:",
    topDomains(profile).map((item) => `- ${item}`).join("\n"),
    "",
    "Mental models:",
    models || "- No mental models available.",
    "",
    "Concept layer:",
    (profile.concepts || [])
      .slice(0, 8)
      .map((concept) => `- ${concept.id}: ${concept.name}; aliases=${(concept.aliases || []).join(", ")}; triggers=${(concept.trigger_conditions || []).join(" / ")}; boundaries=${(concept.boundary_conditions || []).join(" / ")}`)
      .join("\n") || "- No concept layer available.",
    "",
    "Honest boundaries:",
    boundaries || "- Unsupported topics should be answered with low confidence or refused.",
    "",
    "使用 `data/author-judgment-profile.json` 和 `data/judgment-units.json` 作为证据底座。即使证据底座里有英文 schema 或变量 id，最终解释也必须中文化。"
  ].join("\n");
}

function buildSkill(profile) {
  return [
    "---",
    `name: ajm-${profile.profile_id}`,
    `description: 用这个 Author Judgment Model package 以中文回答问题，输出有证据约束的 ${profile.platform} 作者判断逻辑。`,
    "---",
    "",
    `# Author Judgment Model: ${profile.profile_id}`,
    "",
    "当用户询问该蒸馏作者可能如何判断某个语料覆盖主题时，使用这个 skill。",
    "",
    "## Evidence Files",
    "",
    "- `data/author-judgment-profile.json`",
    "- `data/judgment-units.json`",
    "- `data/config.json`",
    "",
    "## Rules",
    "",
    "- 最终回答只能使用中文；内部字段名、unit id、链接可保留原样。",
    "- 不要模仿作者语气或人设。",
    "- 不要声称代表作者本人。",
    "- 主要判断必须落到 profile mental models 或 judgment units。",
    "- 命中 profile concepts 时，必须显式输出概念、触发条件、边界条件和反例。",
    "- 对实时、未来、市场、价格、政策、财报、行情类问题，若用户没有提供事实/事件/数据上下文，只能给判断框架，不能伪装成最终答案。",
    "- 若用户提供了事实/事件/数据上下文，先列出采用了哪些事实，再把事实放入 AJM 变量和证据框架中合成结论。",
    "- 可使用 `node scripts/ajm.js market-context --question \"...\"`、本地 HTML 的“生成市场事实上下文”按钮，或 Futu OpenD / PySnowball / 公开信息获取事实层；事实层必须和 AJM 判断层分开呈现。",
    "- 包含证据 id、置信度和边界。",
    "- 不支持的主题要拒答或降低置信度。",
    "",
    "## Output Shape",
    "",
    "1. 事实/事件上下文",
    "2. 直接回答或判断框架",
    "3. 可能的判断模型",
    "4. 关键变量",
    "5. 证据链",
    "6. 边界和置信度"
  ].join("\n");
}

function buildQaDoc(profile) {
  return [
    `# QA Entry: ${profile.profile_id}`,
    "",
    "通过本地 AJM answer engine 询问已打包的作者判断单元：",
    "",
    "```sh",
    "node scripts/ajm.js answer \\",
    "  --profile <bundle>/data/author-judgment-profile.json \\",
    "  --units <bundle>/data/judgment-units.json \\",
    "  --config <bundle>/data/config.json \\",
    "  --question \"你的问题\"",
    "```",
    "",
    "期望输出包含 `direct_answer`、`reasoned_answer`、`question_classification`、`likely_judgment_model`、`key_variables`、`matched_concept`、`trigger_conditions`、`boundary_conditions`、`evidence_trace` 和 `boundaries_and_confidence`。",
    "",
    "面向用户的回答必须全中文。把它视为历史语料上的判断近似，不是实时建议，也不是作者本人的个人表态。"
  ].join("\n");
}

function buildBrowserIndexHtml() {
  return fs.readFileSync(path.join(__dirname, "..", "templates", "author-package-index.html"), "utf8");
}

function buildManifest(profile, units) {
  return {
    package_type: "author_judgment_unit",
    version: "0.1.0",
    profile_id: profile.profile_id,
    platform: profile.platform,
    author_id: profile.author_id,
    author_handle: profile.author_handle || "",
    coverage: profile.coverage_summary,
    counts: {
      judgment_units: units.length,
      concepts: (profile.concepts || []).length,
      mental_models: (profile.mental_models || []).length,
      decision_heuristics: (profile.decision_heuristics || []).length,
      anti_patterns: (profile.anti_patterns || []).length
    },
    entrypoints: ["index.html", "agent-prompt.md", "SKILL.md", "qa.md"],
    data_files: [
      "data/author-judgment-profile.json",
      "data/judgment-units.json",
      "data/config.json"
    ]
  };
}

function packageAuthorUnit(options) {
  const outDir = path.resolve(options.outDir);
  const profile = readJson(options.profilePath);
  const units = readJson(options.unitsPath);
  const config = options.configPath ? readJson(options.configPath) : { version: "0.1.0", platform: profile.platform, domains: {} };

  writeJson(path.join(outDir, "manifest.json"), buildManifest(profile, units));
  writeFile(path.join(outDir, "index.html"), buildBrowserIndexHtml());
  writeFile(path.join(outDir, "agent-prompt.md"), buildAgentPrompt(profile));
  writeFile(path.join(outDir, "SKILL.md"), buildSkill(profile));
  writeFile(path.join(outDir, "qa.md"), buildQaDoc(profile));
  copyJson(options.profilePath, path.join(outDir, "data", "author-judgment-profile.json"));
  copyJson(options.unitsPath, path.join(outDir, "data", "judgment-units.json"));
  writeJson(path.join(outDir, "data", "config.json"), config);

  return {
    outDir,
    profile_id: profile.profile_id,
    entrypoints: ["index.html", "agent-prompt.md", "SKILL.md", "qa.md"],
    data_files: [
      "data/author-judgment-profile.json",
      "data/judgment-units.json",
      "data/config.json"
    ]
  };
}

module.exports = {
  packageAuthorUnit,
  buildAgentPrompt,
  buildSkill,
  buildQaDoc,
  buildBrowserIndexHtml,
  buildManifest
};
