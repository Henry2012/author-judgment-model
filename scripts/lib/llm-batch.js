const fs = require("fs");
const path = require("path");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readJsonl(filePath) {
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid JSONL at line ${index + 1}: ${error.message}`);
      }
    });
}

function writeJsonl(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
}

function appendJsonl(filePath, row) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(row)}\n`);
}

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function createExtractionPrompt(config) {
  const domains = Object.entries(config.domains || {}).map(([id, domain]) => ({
    id,
    name: domain.name,
    variables: domain.variables || [],
    model_template: domain.model_template
  }));

  return [
    "You extract Author Judgment Model units from Weibo posts.",
    "Return strict JSON only. Do not imitate the author. Do not add real-time facts.",
    "For each post, extract zero or more judgment_units. A unit must be evidence-backed by the given post.",
    "Use this output shape:",
    "{",
    "  \"batch_id\": \"same batch_id as input\",",
    "  \"judgment_units\": [",
    "    {",
    "      \"source_post_id\": \"post id from input\",",
    "      \"domain\": \"one configured domain id or general\",",
    "      \"claim\": \"short evidence-backed judgment claim\",",
    "      \"object\": \"what the judgment is about\",",
    "      \"stance\": \"author stance label\",",
    "      \"variables\": [\"decision variables explicitly implied by the post\"],",
    "      \"causal_chain\": [\"cause\", \"mechanism\", \"effect\"],",
    "      \"decision_rule\": \"if applicable\",",
    "      \"anti_patterns\": [\"rejected reasoning/action pattern\"],",
    "      \"concept_ids\": [\"stable semantic concept ids if configured or inferable\"],",
    "      \"trigger_conditions\": [\"conditions under which this judgment should be applied\"],",
    "      \"boundary_conditions\": [\"conditions where this judgment should be refused, downgraded, or externally verified\"],",
    "      \"counterexamples\": [\"cases that look similar but should not use this judgment\"],",
    "      \"time_scope\": \"when this judgment appears applicable in the corpus\",",
    "      \"confidence_reason\": \"why confidence is low, medium, or high\",",
    "      \"applicability\": \"question types/scenarios this unit can answer\",",
    "      \"misuse_risks\": [\"ways this unit could be over-applied\"],",
    "      \"confidence\": \"low|medium|high\",",
    "      \"evidence_strength\": \"weak|indirect|direct\",",
    "      \"evidence_excerpt\": \"verbatim short excerpt from the post\"",
    "    }",
    "  ]",
    "}",
    "",
    "Configured domains:",
    JSON.stringify(domains, null, 2),
    "",
    "Quality gates:",
    "- Do not summarize personality or tone.",
    "- Extract judgment variables, trigger conditions, boundary conditions, counterexamples, and time applicability explicitly when the post supports them.",
    "- Treat semantic aliases as concepts only when the post gives enough evidence; never rely on keyword matching alone.",
    "- Prefer low confidence when the post is ambiguous.",
    "- Preserve honest boundaries; unsupported inference should produce no unit.",
    "- Every unit must cite source_post_id from input."
  ].join("\n");
}

function createBatchRequests(posts, config, options = {}) {
  const batchSize = Number(options.batchSize || 20);
  const prompt = createExtractionPrompt(config);
  return chunk(posts, batchSize).map((batchPosts, index) => {
    const batchId = `${options.batchPrefix || "batch"}_${String(index + 1).padStart(5, "0")}`;
    return {
      batch_id: batchId,
      task: "extract_judgment_units",
      prompt,
      posts: batchPosts.map((post) => ({
        post_id: post.post_id,
        created_at: post.created_at,
        text: post.text,
        context_text: post.context_text || "",
        url: post.url
      }))
    };
  });
}

function exportExtractionBatches(options) {
  const posts = readJson(options.postsPath);
  const config = readJson(options.configPath);
  const requests = createBatchRequests(posts, config, {
    batchSize: options.batchSize,
    batchPrefix: options.batchPrefix
  });
  writeJsonl(options.outPath, requests);
  return {
    outPath: options.outPath,
    batches: requests.length,
    posts: posts.length,
    batchSize: Number(options.batchSize || 20)
  };
}

function normalizeImportedUnit(unit, sourcePost, unitId) {
  const asArray = (value) => (Array.isArray(value) ? value : []);
  return {
    unit_id: unit.unit_id || unitId,
    source_post_id: unit.source_post_id,
    created_at: sourcePost.created_at || "",
    domain: unit.domain || "general",
    claim: unit.claim || "",
    object: unit.object || "",
    stance: unit.stance || "",
    variables: Array.isArray(unit.variables) ? unit.variables : [],
    causal_chain: Array.isArray(unit.causal_chain) ? unit.causal_chain : [],
    decision_rule: unit.decision_rule || "",
    anti_patterns: Array.isArray(unit.anti_patterns) ? unit.anti_patterns : [],
    concept_ids: asArray(unit.concept_ids),
    trigger_conditions: asArray(unit.trigger_conditions),
    boundary_conditions: asArray(unit.boundary_conditions),
    counterexamples: asArray(unit.counterexamples),
    time_scope: unit.time_scope || "",
    confidence_reason: unit.confidence_reason || "",
    applicability: unit.applicability || "",
    misuse_risks: asArray(unit.misuse_risks),
    confidence: ["low", "medium", "high"].includes(unit.confidence) ? unit.confidence : "low",
    evidence_strength: ["weak", "indirect", "direct"].includes(unit.evidence_strength) ? unit.evidence_strength : "weak",
    evidence_excerpt: unit.evidence_excerpt || "",
    source_url: sourcePost.url || ""
  };
}

function importExtractionResults({ posts, resultRows, unitPrefix = "llm_unit" }) {
  const postById = new Map(posts.map((post) => [post.post_id, post]));
  const units = [];
  const errors = [];
  let counter = 1;

  for (const row of resultRows) {
    const rowUnits = Array.isArray(row.judgment_units) ? row.judgment_units : [];
    for (const unit of rowUnits) {
      if (!unit.source_post_id || !postById.has(unit.source_post_id)) {
        errors.push(`Result ${row.batch_id || "unknown"} references missing post ${unit.source_post_id || "unknown"}`);
        continue;
      }
      if (!unit.claim || !unit.evidence_excerpt) {
        errors.push(`Result ${row.batch_id || "unknown"} has incomplete unit for post ${unit.source_post_id}`);
        continue;
      }
      const unitId = `${unitPrefix}_${String(counter).padStart(6, "0")}`;
      units.push(normalizeImportedUnit(unit, postById.get(unit.source_post_id), unitId));
      counter += 1;
    }
  }

  return { units, errors };
}

function importExtractionResultsFromFiles(options) {
  const posts = readJson(options.postsPath);
  const resultRows = readJsonl(options.resultsPath);
  const imported = importExtractionResults({
    posts,
    resultRows,
    unitPrefix: options.unitPrefix
  });
  if (imported.errors.length) {
    const error = new Error(`LLM extraction import failed:\n${imported.errors.join("\n")}`);
    error.errors = imported.errors;
    throw error;
  }
  writeJson(options.outPath, imported.units);
  return {
    outPath: options.outPath,
    units: imported.units.length
  };
}

function stripJsonFence(value) {
  return String(value || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function parseModelJson(value) {
  if (value && typeof value === "object") return value;
  const text = stripJsonFence(value);
  try {
    return JSON.parse(text);
  } catch (firstError) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    throw firstError;
  }
}

function normalizeBatchResult(request, modelValue) {
  const parsed = parseModelJson(modelValue);
  return {
    batch_id: parsed.batch_id || request.batch_id,
    judgment_units: Array.isArray(parsed.judgment_units) ? parsed.judgment_units : []
  };
}

function createOpenAICompatibleCaller(options = {}) {
  const baseUrl = options.baseUrl || "https://api.openai.com/v1/chat/completions";
  const apiKey = options.apiKey || process.env[options.apiKeyEnv || "OPENAI_API_KEY"];
  const model = options.model;
  const temperature = Number(options.temperature ?? 0.1);
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  if (!model) throw new Error("run-llm-batches requires --model");
  if (!apiKey) throw new Error(`Missing API key env ${options.apiKeyEnv || "OPENAI_API_KEY"}`);
  if (typeof fetchImpl !== "function") throw new Error("No fetch implementation available");

  return async function callOpenAICompatible(request) {
    const response = await fetchImpl(baseUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: request.prompt },
          { role: "user", content: JSON.stringify({ batch_id: request.batch_id, posts: request.posts }) }
        ]
      })
    });

    const body = await response.text();
    if (!response.ok) {
      throw new Error(`LLM request failed for ${request.batch_id}: HTTP ${response.status} ${body}`);
    }
    const data = JSON.parse(body);
    return data.choices?.[0]?.message?.content || data.output_text || data;
  };
}

async function runExtractionBatchRequests({ requestRows, existingResultRows = [], callBatch, limit }) {
  const completed = new Set(existingResultRows.map((row) => row.batch_id).filter(Boolean));
  const pending = requestRows.filter((request) => !completed.has(request.batch_id));
  const max = limit == null ? pending.length : Math.min(Number(limit), pending.length);
  const results = [];

  for (const request of pending.slice(0, max)) {
    const modelValue = await callBatch(request);
    results.push(normalizeBatchResult(request, modelValue));
  }

  return {
    skipped: completed.size,
    processed: results.length,
    remaining: pending.length - results.length,
    results
  };
}

async function runExtractionBatchRequestsFromFiles(options) {
  const requestRows = readJsonl(options.requestsPath);
  const existingResultRows = fs.existsSync(options.resultsPath) ? readJsonl(options.resultsPath) : [];
  const callBatch =
    options.callBatch ||
    createOpenAICompatibleCaller({
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
      apiKeyEnv: options.apiKeyEnv,
      model: options.model,
      temperature: options.temperature
    });

  const summary = await runExtractionBatchRequests({
    requestRows,
    existingResultRows,
    callBatch,
    limit: options.limit
  });

  for (const result of summary.results) {
    appendJsonl(options.resultsPath, result);
  }

  return {
    resultsPath: options.resultsPath,
    totalBatches: requestRows.length,
    skipped: summary.skipped,
    processed: summary.processed,
    remaining: summary.remaining
  };
}

module.exports = {
  createExtractionPrompt,
  createBatchRequests,
  exportExtractionBatches,
  importExtractionResults,
  importExtractionResultsFromFiles,
  parseModelJson,
  normalizeBatchResult,
  createOpenAICompatibleCaller,
  runExtractionBatchRequests,
  runExtractionBatchRequestsFromFiles
};
