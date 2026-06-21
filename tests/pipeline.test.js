const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  normalizeWeiboRaw,
  extractJudgmentUnits,
  buildEvidenceMaps,
  buildProfile,
  runPipeline,
  buildArtifactsFromUnits
} = require("../scripts/lib/pipeline");
const { answerQuestion } = require("../scripts/lib/answer");
const { validateArtifacts } = require("../scripts/lib/validate");
const {
  createBatchRequests,
  importExtractionResults,
  parseModelJson,
  runExtractionBatchRequestsFromFiles
} = require("../scripts/lib/llm-batch");
const { runValidationCases, applyValidationResultsToProfile } = require("../scripts/lib/validation-cases");
const { generateValidationCases, generateValidationCasesFromFiles } = require("../scripts/lib/validation-case-generator");
const { buildReviewReport } = require("../scripts/lib/report");
const { distillWeibo } = require("../scripts/lib/distill");
const { suggestWeiboConfig } = require("../scripts/lib/config-suggest");
const { packageAuthorUnit } = require("../scripts/lib/package-author");
const { exportReviewPack } = require("../scripts/lib/review-pack");
const { buildWeiboAuthorUnit } = require("../scripts/lib/build-author-unit");
const { evaluateQualityGate } = require("../scripts/lib/quality-gate");
const { applyReviewToProfileFromFiles } = require("../scripts/lib/apply-review");
const { applyReviewCorrectionsFromFiles } = require("../scripts/lib/apply-review-corrections");
const { pruneWeakUnitsFromFiles } = require("../scripts/lib/unit-quality");

const config = require("../configs/weibo.default.json");

function sampleRaw() {
  return {
    collectedAt: "2026-06-20T04:25:05.204Z",
    target: "https://weibo.com/u/123456",
    rows: [
      {
        id: "A1",
        bid: "A1",
        created_at: "2026-06-20 11:38",
        text: "买房不能只看过去涨不涨，要看城市机会、租售比和退出成本。",
        url: "https://weibo.com/123456/A1",
        capture_method: "chrome_logged_in_dom_scroll",
        captured_at: "2026-06-20T04:11:58.384Z",
        attitudes_count: 10,
        comments_count: 2,
        reposts_count: 1
      },
      {
        id: "A2",
        bid: "A2",
        created_at: "2026-06-21 09:10",
        text: "投资工具不要当信仰，股市逻辑变了就先停下来观察。",
        url: "https://weibo.com/123456/A2",
        capture_method: "chrome_logged_in_dom_scroll",
        captured_at: "2026-06-21T01:10:00.000Z",
        attitudes_count: 5,
        comments_count: 1,
        reposts_count: 0
      },
      {
        id: "A3",
        bid: "A3",
        created_at: "热门",
        text: "没有明确主题的置顶内容也应该保留，但不能污染日期覆盖范围。",
        url: "https://weibo.com/123456/A3",
        capture_method: "chrome_logged_in_dom_scroll",
        captured_at: "2026-06-21T01:10:00.000Z",
        attitudes_count: 0,
        comments_count: 0,
        reposts_count: 0
      }
    ]
  };
}

function nonDefaultRaw() {
  return {
    collectedAt: "2026-06-22T00:00:00.000Z",
    target: "https://weibo.com/u/999999",
    rows: [
      {
        id: "C1",
        created_at: "2026-06-22 08:00",
        text: "做面包不要偷懒，发酵时间和烤箱温度比玄学配方重要。",
        url: "https://weibo.com/999999/C1"
      },
      {
        id: "C2",
        created_at: "2026-06-22 09:00",
        text: "烘焙失败先看面粉吸水、发酵状态和烤箱温度，不要只怪配方。",
        url: "https://weibo.com/999999/C2"
      },
      {
        id: "C3",
        created_at: "2026-06-22 10:00",
        text: "训练计划别迷信打卡，力量增长、睡眠恢复和动作质量更重要。",
        url: "https://weibo.com/999999/C3"
      },
      {
        id: "C4",
        created_at: "2026-06-22 11:00",
        text: "健身减脂要看饮食执行、力量训练和睡眠，不要只看体重波动。",
        url: "https://weibo.com/999999/C4"
      }
    ]
  };
}

test("normalizes Weibo raw rows into canonical posts", () => {
  const posts = normalizeWeiboRaw(sampleRaw(), { authorHandle: "sample" });
  assert.equal(posts.length, 3);
  assert.equal(posts[0].platform, "weibo");
  assert.equal(posts[0].author_id, "123456");
  assert.equal(posts[0].created_at, "2026-06-20T11:38:00+08:00");
  assert.equal(posts[0].engagement.likes, 10);
});

test("extracts evidence-backed judgment units and maps from posts", () => {
  const posts = normalizeWeiboRaw(sampleRaw(), { authorHandle: "sample" });
  const units = extractJudgmentUnits(posts, config);
  const maps = buildEvidenceMaps(units, config);
  const profile = buildProfile(posts, units, maps, config, { authorHandle: "sample" }, sampleRaw());

  assert.ok(units.some((unit) => unit.domain === "real_estate"));
  assert.ok(units.some((unit) => unit.domain === "stock_market"));
  assert.ok(maps.some((map) => map.domain === "real_estate"));
  assert.equal(profile.profile_id, "weibo-123456");
  assert.ok(profile.mental_models.length >= 1);
});

test("runs the Weibo AJM pipeline and writes reusable artifacts", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ajm-pipeline-"));
  const rawPath = path.join(tmp, "raw-index.json");
  fs.writeFileSync(rawPath, JSON.stringify(sampleRaw(), null, 2));

  const result = runPipeline({
    rawPath,
    authorHandle: "sample",
    outDir: path.join(tmp, "data"),
    configPath: path.join(process.cwd(), "configs/weibo.default.json")
  });

  assert.equal(result.slug, "weibo-123456");
  assert.equal(result.posts, 3);
  assert.ok(result.units >= 2);
  assert.ok(fs.existsSync(result.profilePath));
  assert.ok(fs.existsSync(path.join(tmp, "data", "judgment-units", "weibo-123456", "judgment-units.json")));

  const profile = JSON.parse(fs.readFileSync(result.profilePath, "utf8"));
  assert.equal(profile.coverage_summary.last_created_at, "2026-06-21T09:10:00+08:00");
});

test("distills arbitrary Weibo raw indexes into reviewable author artifacts", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ajm-distill-"));
  const rawPath = path.join(tmp, "raw-index.json");
  const casesPath = path.join(tmp, "validation-cases.json");
  fs.writeFileSync(rawPath, JSON.stringify(sampleRaw(), null, 2));
  fs.writeFileSync(
    casesPath,
    JSON.stringify(
      [
        {
          case_id: "sample_real_estate_distill",
          question: "现在买房主要看什么？",
          expected_models: ["model_real_estate"],
          expected_variables: ["city_opportunity"],
          pass_criteria: ["cites evidence units", "readable reasoning"]
        }
      ],
      null,
      2
    )
  );

  const result = distillWeibo({
    rawPath,
    authorHandle: "sample",
    outDir: path.join(tmp, "data"),
    configPath: path.join(process.cwd(), "configs/weibo.default.json"),
    validationCasesPath: casesPath,
    validationId: "distill_test_validation"
  });

  assert.equal(result.slug, "weibo-123456");
  assert.equal(result.posts, 3);
  assert.ok(result.units >= 2);
  assert.ok(fs.existsSync(result.postsPath));
  assert.ok(fs.existsSync(result.unitsPath));
  assert.ok(fs.existsSync(result.evidenceMapsPath));
  assert.ok(fs.existsSync(result.profilePath));
  assert.equal(result.validationApplied.status, "pass");
  assert.equal(result.report.validation.status, "pass");
  assert.equal(result.report.counts.posts, 3);
  assert.ok(!result.report.risks.includes("validation_results_not_embedded_in_profile"));

  const profile = JSON.parse(fs.readFileSync(result.profilePath, "utf8"));
  assert.equal(profile.validation_results.at(-1).validation_id, "distill_test_validation");
});

test("distills Weibo raw indexes from reviewed LLM extraction results", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ajm-distill-llm-"));
  const rawPath = path.join(tmp, "raw-index.json");
  const resultsPath = path.join(tmp, "results.jsonl");
  fs.writeFileSync(rawPath, JSON.stringify(sampleRaw(), null, 2));
  fs.writeFileSync(
    resultsPath,
    `${JSON.stringify({
      batch_id: "sample_00001",
      judgment_units: [
        {
          source_post_id: "A1",
          domain: "real_estate",
          claim: "Housing judgment should consider city opportunity, rent-to-price ratio, and exit cost.",
          object: "housing decision",
          stance: "tool_view",
          variables: ["city_opportunity", "rent_to_price_ratio", "exit_cost"],
          causal_chain: ["past price gains", "current variables ignored", "bad housing decision"],
          decision_rule: "Evaluate housing by current variables rather than past price gains.",
          anti_patterns: ["old_rule_extrapolation"],
          confidence: "high",
          evidence_strength: "direct",
          evidence_excerpt: "买房不能只看过去涨不涨，要看城市机会、租售比和退出成本。"
        }
      ]
    })}\n`
  );

  const result = distillWeibo({
    rawPath,
    authorHandle: "sample",
    outDir: path.join(tmp, "data"),
    configPath: path.join(process.cwd(), "configs/weibo.default.json"),
    llmResultsPath: resultsPath,
    unitPrefix: "reviewed_unit"
  });

  assert.equal(result.slug, "weibo-123456");
  assert.equal(result.llmImported.units, 1);
  assert.equal(result.units, 1);
  assert.equal(result.evidenceMaps, 1);

  const units = JSON.parse(fs.readFileSync(result.unitsPath, "utf8"));
  assert.equal(units[0].unit_id, "reviewed_unit_000001");

  const profile = JSON.parse(fs.readFileSync(result.profilePath, "utf8"));
  assert.equal(profile.mental_models[0].id, "model_real_estate");
  assert.ok(profile.mental_models[0].definition.includes("Evaluate housing by current variables"));
});

test("packages a distilled author unit into agent, skill, and QA artifacts", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ajm-package-"));
  const rawPath = path.join(tmp, "raw-index.json");
  fs.writeFileSync(rawPath, JSON.stringify(sampleRaw(), null, 2));
  const distilled = distillWeibo({
    rawPath,
    authorHandle: "sample",
    outDir: path.join(tmp, "data"),
    configPath: path.join(process.cwd(), "configs/weibo.default.json")
  });

  const packaged = packageAuthorUnit({
    profilePath: distilled.profilePath,
    unitsPath: distilled.unitsPath,
    configPath: path.join(process.cwd(), "configs/weibo.default.json"),
    outDir: path.join(tmp, "bundle")
  });

  assert.equal(packaged.profile_id, "weibo-123456");
  assert.ok(fs.existsSync(path.join(packaged.outDir, "manifest.json")));
  assert.ok(fs.existsSync(path.join(packaged.outDir, "index.html")));
  assert.ok(fs.existsSync(path.join(packaged.outDir, "agent-prompt.md")));
  assert.ok(fs.existsSync(path.join(packaged.outDir, "SKILL.md")));
  assert.ok(fs.existsSync(path.join(packaged.outDir, "qa.md")));
  assert.ok(fs.existsSync(path.join(packaged.outDir, "data", "author-judgment-profile.json")));
  assert.ok(fs.existsSync(path.join(packaged.outDir, "data", "judgment-units.json")));

  const manifest = JSON.parse(fs.readFileSync(path.join(packaged.outDir, "manifest.json"), "utf8"));
  assert.deepEqual(manifest.entrypoints, ["index.html", "agent-prompt.md", "SKILL.md", "qa.md"]);
  assert.equal(manifest.profile_id, "weibo-123456");

  const index = fs.readFileSync(path.join(packaged.outDir, "index.html"), "utf8");
  assert.ok(index.includes("AJM 可视化问答"));
  assert.ok(index.includes("data/author-judgment-profile.json"));

  const prompt = fs.readFileSync(path.join(packaged.outDir, "agent-prompt.md"), "utf8");
  assert.ok(prompt.includes("最终回答只能使用中文"));
  assert.ok(prompt.includes("证据链"));
  assert.ok(prompt.includes("weibo-123456"));

  const skill = fs.readFileSync(path.join(packaged.outDir, "SKILL.md"), "utf8");
  assert.ok(skill.includes("Author Judgment Model"));
  assert.ok(skill.includes("data/author-judgment-profile.json"));

  const qa = fs.readFileSync(path.join(packaged.outDir, "qa.md"), "utf8");
  assert.ok(qa.includes("node"));
  assert.ok(qa.includes("scripts/ajm.js answer"));
});

test("exports a manual review pack for distilled author artifacts", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ajm-review-pack-"));
  const rawPath = path.join(tmp, "raw-index.json");
  fs.writeFileSync(rawPath, JSON.stringify(sampleRaw(), null, 2));
  const distilled = distillWeibo({
    rawPath,
    authorHandle: "sample",
    outDir: path.join(tmp, "data"),
    configPath: path.join(process.cwd(), "configs/weibo.default.json")
  });

  const result = exportReviewPack({
    postsPath: distilled.postsPath,
    unitsPath: distilled.unitsPath,
    evidenceMapsPath: distilled.evidenceMapsPath,
    profilePath: distilled.profilePath,
    outDir: path.join(tmp, "review"),
    samplesPerDomain: 2
  });

  assert.equal(result.profile_id, "weibo-123456");
  assert.ok(fs.existsSync(path.join(result.outDir, "review-report.json")));
  assert.ok(fs.existsSync(path.join(result.outDir, "sample-units.json")));
  assert.ok(fs.existsSync(path.join(result.outDir, "sample-units.md")));
  assert.ok(fs.existsSync(path.join(result.outDir, "review-checklist.md")));
  assert.ok(fs.existsSync(path.join(result.outDir, "manual-review-template.json")));
  assert.ok(result.sample_units.length >= 2);

  const checklist = fs.readFileSync(path.join(result.outDir, "review-checklist.md"), "utf8");
  assert.ok(checklist.includes("Evidence Grounding"));
  assert.ok(checklist.includes("Pass Criteria"));
  assert.ok(checklist.includes("Unsupported Topic Boundary"));

  const template = JSON.parse(fs.readFileSync(path.join(result.outDir, "manual-review-template.json"), "utf8"));
  assert.equal(template.profile_id, "weibo-123456");
  assert.ok(template.domain_reviews.some((item) => item.domain === "real_estate"));
  assert.ok(template.domain_reviews.every((item) => item.status === "pending"));
});

test("applies manual review results back into the author profile", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ajm-apply-review-"));
  const rawPath = path.join(tmp, "raw-index.json");
  fs.writeFileSync(rawPath, JSON.stringify(sampleRaw(), null, 2));
  const distilled = distillWeibo({
    rawPath,
    authorHandle: "sample",
    outDir: path.join(tmp, "data"),
    configPath: path.join(process.cwd(), "configs/weibo.default.json")
  });
  const reviewPack = exportReviewPack({
    postsPath: distilled.postsPath,
    unitsPath: distilled.unitsPath,
    evidenceMapsPath: distilled.evidenceMapsPath,
    profilePath: distilled.profilePath,
    outDir: path.join(tmp, "review"),
    samplesPerDomain: 1
  });
  const reviewPath = path.join(reviewPack.outDir, "manual-review-template.json");
  const review = JSON.parse(fs.readFileSync(reviewPath, "utf8"));
  review.status = "approved_with_notes";
  review.reviewer = "test-reviewer";
  review.reviewed_at = "2026-06-20T00:00:00.000Z";
  review.overall_notes = "Evidence samples checked; keep low-confidence warning visible.";
  review.pass_criteria.evidence_samples_reviewed = true;
  review.pass_criteria.unsupported_topic_boundary_checked = true;
  review.domain_reviews = review.domain_reviews.map((item, index) => ({
    ...item,
    status: index === 0 ? "approved" : "needs_revision",
    notes: index === 0 ? "Looks grounded." : "Rename variables before serious use."
  }));
  review.issue_log = [
    {
      severity: "warning",
      item_type: "domain",
      item_id: review.domain_reviews[1].domain,
      note: "Variables are too generic."
    }
  ];
  fs.writeFileSync(reviewPath, `${JSON.stringify(review, null, 2)}\n`);

  const outPath = path.join(tmp, "reviewed-profile.json");
  const result = applyReviewToProfileFromFiles({
    reviewPath,
    profilePath: distilled.profilePath,
    outPath,
    reviewId: "manual_review_test"
  });

  assert.equal(result.status, "approved_with_notes");
  assert.equal(result.review_results, 1);
  assert.equal(result.outPath, outPath);

  const updated = JSON.parse(fs.readFileSync(outPath, "utf8"));
  assert.equal(updated.review_results.at(-1).review_id, "manual_review_test");
  assert.equal(updated.review_results.at(-1).reviewer, "test-reviewer");
  assert.equal(updated.review_results.at(-1).domain_counts.approved, 1);
  assert.equal(updated.review_results.at(-1).domain_counts.needs_revision, 1);
  assert.equal(updated.review_results.at(-1).issue_count, 1);
  assert.equal(updated.update_history.at(-1).event, "manual_review_applied");
});

test("applies manual review corrections and rebuilds author artifacts", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ajm-apply-review-corrections-"));
  const rawPath = path.join(tmp, "raw-index.json");
  fs.writeFileSync(rawPath, JSON.stringify(sampleRaw(), null, 2));
  const distilled = distillWeibo({
    rawPath,
    authorHandle: "sample",
    outDir: path.join(tmp, "data"),
    configPath: path.join(process.cwd(), "configs/weibo.default.json")
  });
  const reviewPack = exportReviewPack({
    postsPath: distilled.postsPath,
    unitsPath: distilled.unitsPath,
    evidenceMapsPath: distilled.evidenceMapsPath,
    profilePath: distilled.profilePath,
    outDir: path.join(tmp, "review"),
    samplesPerDomain: 2
  });
  const reviewPath = path.join(reviewPack.outDir, "manual-review-template.json");
  const review = JSON.parse(fs.readFileSync(reviewPath, "utf8"));
  const realEstateReview = review.domain_reviews.find((item) => item.domain === "real_estate");
  const stockReview = review.domain_reviews.find((item) => item.domain === "stock_market");
  const rejectedUnitId = realEstateReview.sampled_unit_ids[0];
  const revisionUnitId = stockReview.sampled_unit_ids[0];
  review.status = "needs_revision";
  review.reviewer = "test-reviewer";
  review.reviewed_at = "2026-06-20T00:00:00.000Z";
  review.domain_reviews = review.domain_reviews.map((item) => ({
    ...item,
    status: item.domain === "stock_market" ? "needs_revision" : "approved",
    notes: item.domain === "stock_market" ? "One sampled unit needs a tighter variable name." : "Looks grounded."
  }));
  review.issue_log = [
    {
      severity: "error",
      item_type: "unit",
      item_id: rejectedUnitId,
      action: "reject",
      note: "Evidence does not support this extracted judgment."
    }
  ];
  fs.writeFileSync(reviewPath, `${JSON.stringify(review, null, 2)}\n`);

  const result = applyReviewCorrectionsFromFiles({
    reviewPath,
    postsPath: distilled.postsPath,
    unitsPath: distilled.unitsPath,
    outDir: path.join(tmp, "corrected"),
    configPath: path.join(process.cwd(), "configs/weibo.default.json"),
    authorHandle: "sample",
    reviewId: "manual_correction_test",
    minPosts: 1,
    minJudgmentUnits: 1,
    minMentalModels: 1
  });

  assert.equal(result.profile_id, "weibo-123456");
  assert.ok(result.removed_units.includes(rejectedUnitId));
  assert.ok(fs.existsSync(result.correctedUnitsPath));
  assert.ok(fs.existsSync(result.evidenceMapsPath));
  assert.ok(fs.existsSync(result.profilePath));
  assert.ok(fs.existsSync(result.qualityGatePath));
  assert.ok(fs.existsSync(result.correctionReportPath));

  const correctedUnits = JSON.parse(fs.readFileSync(result.correctedUnitsPath, "utf8"));
  assert.ok(!correctedUnits.some((unit) => unit.unit_id === rejectedUnitId));
  assert.ok(correctedUnits.some((unit) => unit.unit_id === revisionUnitId && unit.review_status === "needs_revision"));

  const correctedProfile = JSON.parse(fs.readFileSync(result.profilePath, "utf8"));
  assert.equal(correctedProfile.review_results.at(-1).review_id, "manual_correction_test");
  assert.equal(correctedProfile.update_history.at(-1).event, "manual_review_applied");
  assert.equal(result.quality_gate.status, "warn");
});

test("evaluates quality gate status for pass, warn, and fail cases", () => {
  const passPosts = [
    {
      platform: "weibo",
      author_id: "777777",
      post_id: "P1",
      created_at: "2026-06-20T08:00:00+08:00",
      text: "烘焙失败要看发酵时间和烤箱温度。",
      context_text: "",
      url: "https://weibo.com/777777/P1",
      engagement: { likes: 0, comments: 0, reposts: 0 },
      capture: {}
    },
    {
      platform: "weibo",
      author_id: "777777",
      post_id: "P2",
      created_at: "2026-06-21T08:00:00+08:00",
      text: "训练效果要看力量增长和睡眠恢复。",
      context_text: "",
      url: "https://weibo.com/777777/P2",
      engagement: { likes: 0, comments: 0, reposts: 0 },
      capture: {}
    },
    {
      platform: "weibo",
      author_id: "777777",
      post_id: "P3",
      created_at: "2026-06-22T08:00:00+08:00",
      text: "减脂不要只看体重，要看饮食执行。",
      context_text: "",
      url: "https://weibo.com/777777/P3",
      engagement: { likes: 0, comments: 0, reposts: 0 },
      capture: {}
    }
  ];
  const passUnits = [
    {
      unit_id: "unit_000001",
      source_post_id: "P1",
      domain: "baking",
      claim: "Baking should be judged by fermentation time and oven temperature.",
      variables: ["fermentation_time", "oven_temperature"],
      evidence_excerpt: "烘焙失败要看发酵时间和烤箱温度。",
      evidence_strength: "direct",
      confidence: "high"
    },
    {
      unit_id: "unit_000002",
      source_post_id: "P2",
      domain: "training",
      claim: "Training should be judged by strength and sleep recovery.",
      variables: ["strength_growth", "sleep_recovery"],
      evidence_excerpt: "训练效果要看力量增长和睡眠恢复。",
      evidence_strength: "direct",
      confidence: "high"
    },
    {
      unit_id: "unit_000003",
      source_post_id: "P3",
      domain: "nutrition",
      claim: "Fat loss should be judged by diet execution rather than weight alone.",
      variables: ["diet_execution", "weight_volatility"],
      evidence_excerpt: "减脂不要只看体重，要看饮食执行。",
      evidence_strength: "direct",
      confidence: "high"
    }
  ];
  const passMaps = [
    {
      domain: "baking",
      core_judgment: "Baking depends on process variables.",
      supporting_units: ["unit_000001"],
      conflicting_units: [],
      key_variables: ["fermentation_time", "oven_temperature"],
      boundary: ["Corpus-backed only."],
      confidence: "medium"
    },
    {
      domain: "training",
      core_judgment: "Training depends on adaptation and recovery.",
      supporting_units: ["unit_000002"],
      conflicting_units: [],
      key_variables: ["strength_growth", "sleep_recovery"],
      boundary: ["Corpus-backed only."],
      confidence: "medium"
    },
    {
      domain: "nutrition",
      core_judgment: "Nutrition depends on execution quality.",
      supporting_units: ["unit_000003"],
      conflicting_units: [],
      key_variables: ["diet_execution", "weight_volatility"],
      boundary: ["Corpus-backed only."],
      confidence: "medium"
    }
  ];
  const passProfile = {
    profile_id: "weibo-777777",
    platform: "weibo",
    author_id: "777777",
    coverage_summary: {
      first_created_at: "2026-06-20T08:00:00+08:00",
      last_created_at: "2026-06-22T08:00:00+08:00"
    },
    domain_map: {
      baking: { unit_count: 1, evidence_strength: "direct" },
      training: { unit_count: 1, evidence_strength: "direct" },
      nutrition: { unit_count: 1, evidence_strength: "direct" }
    },
    mental_models: passMaps.map((map) => ({
      id: `model_${map.domain}`,
      name: map.domain,
      definition: map.core_judgment,
      domains: [map.domain],
      variables: map.key_variables,
      evidence_unit_ids: map.supporting_units,
      limitations: ["Corpus-backed only."]
    })),
    decision_heuristics: passMaps.map((map) => ({ id: `heuristic_${map.domain}` })),
    anti_patterns: [],
    honest_boundaries: ["Unsupported topics should be refused."],
    evidence_map_refs: passMaps.map((map) => `evidence-maps/${map.domain}.json`),
    validation_results: [{ validation_id: "manual_validation", status: "pass", cases: 3, passed: 3, failed: 0 }],
    update_history: []
  };

  const passGate = evaluateQualityGate({
    posts: passPosts,
    units: passUnits,
    evidenceMaps: passMaps,
    profile: passProfile,
    thresholds: { minPosts: 3, minJudgmentUnits: 3, minMentalModels: 3 }
  });
  assert.equal(passGate.status, "pass");
  assert.equal(passGate.blocking_issues.length, 0);

  const warnProfile = { ...passProfile, validation_results: [] };
  const warnGate = evaluateQualityGate({
    posts: passPosts,
    units: passUnits,
    evidenceMaps: passMaps,
    profile: warnProfile,
    thresholds: { minPosts: 3, minJudgmentUnits: 3, minMentalModels: 3 }
  });
  assert.equal(warnGate.status, "warn");
  assert.ok(warnGate.warnings.includes("validation_results_not_embedded_in_profile"));

  const failUnits = [
    {
      ...passUnits[0],
      evidence_excerpt: "这段证据不在原文里"
    }
  ];
  const failGate = evaluateQualityGate({
    posts: passPosts,
    units: failUnits,
    evidenceMaps: [passMaps[0]],
    profile: { ...passProfile, mental_models: [passProfile.mental_models[0]], decision_heuristics: [passProfile.decision_heuristics[0]] },
    thresholds: { minPosts: 3, minJudgmentUnits: 1, minMentalModels: 1 }
  });
  assert.equal(failGate.status, "fail");
  assert.ok(failGate.blocking_issues.includes("artifact_validation_failed"));
});

test("prunes weak units and rebuilds quality-gated author artifacts", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ajm-prune-weak-units-"));
  const posts = [
    {
      platform: "weibo",
      author_id: "777777",
      author_handle: "sample",
      post_id: "P1",
      created_at: "2026-06-20T08:00:00+08:00",
      text: "买房要看城市机会和退出成本。",
      context_text: "",
      url: "https://weibo.com/777777/P1",
      engagement: { likes: 0, comments: 0, reposts: 0 },
      capture: {}
    },
    {
      platform: "weibo",
      author_id: "777777",
      author_handle: "sample",
      post_id: "P2",
      created_at: "2026-06-21T08:00:00+08:00",
      text: "股市要看估值和资金流。",
      context_text: "",
      url: "https://weibo.com/777777/P2",
      engagement: { likes: 0, comments: 0, reposts: 0 },
      capture: {}
    },
    {
      platform: "weibo",
      author_id: "777777",
      author_handle: "sample",
      post_id: "P3",
      created_at: "2026-06-22T08:00:00+08:00",
      text: "政策要看财政约束和人口结构。",
      context_text: "",
      url: "https://weibo.com/777777/P3",
      engagement: { likes: 0, comments: 0, reposts: 0 },
      capture: {}
    },
    {
      platform: "weibo",
      author_id: "777777",
      author_handle: "sample",
      post_id: "P4",
      created_at: "2026-06-22T08:00:00+08:00",
      text: "含糊地聊一点别的。",
      context_text: "",
      url: "https://weibo.com/777777/P4",
      engagement: { likes: 0, comments: 0, reposts: 0 },
      capture: {}
    }
  ];
  const units = [
    {
      unit_id: "unit_keep_real_estate",
      source_post_id: "P1",
      domain: "real_estate",
      claim: "Housing should be judged by city opportunity and exit cost.",
      variables: ["city_opportunity", "exit_cost"],
      causal_chain: [],
      decision_rule: "",
      anti_patterns: [],
      evidence_excerpt: "买房要看城市机会和退出成本。",
      evidence_strength: "direct",
      confidence: "medium"
    },
    {
      unit_id: "unit_keep_stock",
      source_post_id: "P2",
      domain: "stock_market",
      claim: "Stocks should be judged by valuation and capital flow.",
      variables: ["valuation", "capital_flow"],
      causal_chain: [],
      decision_rule: "",
      anti_patterns: [],
      evidence_excerpt: "股市要看估值和资金流。",
      evidence_strength: "direct",
      confidence: "high"
    },
    {
      unit_id: "unit_keep_macro",
      source_post_id: "P3",
      domain: "macro_policy",
      claim: "Policy should be judged by fiscal constraint and population structure.",
      variables: ["fiscal_constraint", "population_structure"],
      causal_chain: [],
      decision_rule: "",
      anti_patterns: [],
      evidence_excerpt: "政策要看财政约束和人口结构。",
      evidence_strength: "direct",
      confidence: "medium"
    },
    {
      unit_id: "unit_drop_weak",
      source_post_id: "P4",
      domain: "real_estate",
      claim: "Weakly supported claim should be pruned.",
      variables: ["city_opportunity"],
      causal_chain: [],
      decision_rule: "",
      anti_patterns: [],
      evidence_excerpt: "含糊地聊一点别的。",
      evidence_strength: "weak",
      confidence: "low"
    }
  ];
  const maps = buildEvidenceMaps(units, config);
  const profile = {
    ...buildProfile(posts, units, maps, config, { authorId: "777777", authorHandle: "sample" }),
    validation_results: [{ validation_id: "baseline", status: "pass", cases: 2, passed: 2, failed: 0, case_results: [] }]
  };
  const postsPath = path.join(tmp, "posts.json");
  const unitsPath = path.join(tmp, "units.json");
  const profilePath = path.join(tmp, "profile.json");
  fs.writeFileSync(postsPath, `${JSON.stringify(posts, null, 2)}\n`);
  fs.writeFileSync(unitsPath, `${JSON.stringify(units, null, 2)}\n`);
  fs.writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`);

  const result = pruneWeakUnitsFromFiles({
    postsPath,
    unitsPath,
    profilePath,
    outDir: path.join(tmp, "pruned"),
    configPath: path.join(process.cwd(), "configs/weibo.default.json"),
    authorId: "777777",
    authorHandle: "sample",
    minPosts: 3,
    minJudgmentUnits: 3,
    minMentalModels: 3,
    warnLowConfidenceUnitRatio: 0.6
  });

  assert.deepEqual(result.removed_units, ["unit_drop_weak"]);
  assert.equal(result.quality_gate.status, "pass");
  assert.ok(fs.existsSync(result.prunedUnitsPath));
  assert.ok(fs.existsSync(result.weakUnitReportPath));
  assert.ok(fs.existsSync(result.profilePath));

  const prunedUnits = JSON.parse(fs.readFileSync(result.prunedUnitsPath, "utf8"));
  assert.equal(prunedUnits.length, 3);
  assert.ok(prunedUnits.every((unit) => unit.confidence !== "low" && unit.evidence_strength !== "weak"));

  const report = JSON.parse(fs.readFileSync(result.weakUnitReportPath, "utf8"));
  assert.equal(report.input_units, 4);
  assert.equal(report.output_units, 3);
  assert.equal(report.low_confidence_unit_ratio_before, 1 / 4);
  assert.equal(report.low_confidence_unit_ratio_after, 0);

  const rebuiltProfile = JSON.parse(fs.readFileSync(result.profilePath, "utf8"));
  assert.equal(rebuiltProfile.validation_results.length, 1);
  assert.equal(rebuiltProfile.update_history.at(-1).event, "weak_units_pruned");
});

test("builds a complete Weibo author unit from raw input", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ajm-full-build-"));
  const rawPath = path.join(tmp, "raw-index.json");
  fs.writeFileSync(rawPath, JSON.stringify(sampleRaw(), null, 2));

  const result = buildWeiboAuthorUnit({
    rawPath,
    authorHandle: "sample",
    outDir: path.join(tmp, "author-unit"),
    configPath: path.join(process.cwd(), "configs/weibo.default.json"),
    samplesPerDomain: 2
  });

  assert.equal(result.profile_id, "weibo-123456");
  assert.ok(fs.existsSync(result.manifestPath));
  assert.ok(fs.existsSync(path.join(result.paths.dataDir, "profiles", "weibo-123456", "author-judgment-profile.json")));
  assert.ok(fs.existsSync(path.join(result.paths.reviewDir, "review-checklist.md")));
  assert.ok(fs.existsSync(path.join(result.paths.reviewDir, "quality-gate.json")));
  assert.ok(fs.existsSync(path.join(result.paths.packageDir, "agent-prompt.md")));
  assert.ok(fs.existsSync(path.join(result.paths.packageDir, "SKILL.md")));

  const manifest = JSON.parse(fs.readFileSync(result.manifestPath, "utf8"));
  assert.equal(manifest.profile_id, "weibo-123456");
  assert.deepEqual(manifest.stages, ["distill", "review-pack", "quality-gate", "package-author"]);
  assert.equal(manifest.quality_gate.status, "warn");
  assert.equal(manifest.artifacts.package, result.paths.packageDir);
  assert.equal(manifest.artifacts.review, result.paths.reviewDir);
  assert.equal(manifest.artifacts.profile, result.distill.profilePath);
});

test("blocks package generation when the quality gate fails", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ajm-full-build-blocked-"));
  const rawPath = path.join(tmp, "raw-index.json");
  const outDir = path.join(tmp, "author-unit");
  fs.writeFileSync(rawPath, JSON.stringify(sampleRaw(), null, 2));

  assert.throws(
    () =>
      buildWeiboAuthorUnit({
        rawPath,
        authorHandle: "sample",
        outDir,
        configPath: path.join(process.cwd(), "configs/weibo.default.json"),
        samplesPerDomain: 2,
        failGeneralUnitRatio: 0.1
      }),
    (error) => {
      assert.equal(error.code, "QUALITY_GATE_FAILED");
      assert.ok(fs.existsSync(error.manifestPath));
      assert.equal(error.qualityGate.status, "fail");
      return true;
    }
  );

  const manifest = JSON.parse(fs.readFileSync(path.join(outDir, "build-manifest.json"), "utf8"));
  assert.deepEqual(manifest.stages, ["distill", "review-pack", "quality-gate"]);
  assert.equal(manifest.package.blocked, true);
  assert.equal(manifest.artifacts.package, null);
  assert.ok(!fs.existsSync(path.join(outDir, "package", "agent-prompt.md")));
});

test("builds a complete Weibo author unit for non-default topics with a suggested config", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ajm-full-build-suggest-"));
  const rawPath = path.join(tmp, "raw-index.json");
  fs.writeFileSync(rawPath, JSON.stringify(nonDefaultRaw(), null, 2));

  const result = buildWeiboAuthorUnit({
    rawPath,
    authorHandle: "mixed-author",
    outDir: path.join(tmp, "author-unit"),
    suggestConfig: true,
    maxDomains: 2,
    samplesPerDomain: 2
  });

  assert.equal(result.profile_id, "weibo-999999");
  assert.ok(fs.existsSync(result.paths.configPath));
  assert.ok(result.distill.evidenceMaps >= 1);
  assert.ok(result.review.sample_units.length >= 1);
  assert.ok(fs.existsSync(path.join(result.paths.packageDir, "agent-prompt.md")));

  const generatedConfig = JSON.parse(fs.readFileSync(result.paths.configPath, "utf8"));
  const keywords = Object.values(generatedConfig.domains).flatMap((domain) => domain.keywords);
  assert.ok(keywords.includes("发酵"));
  assert.ok(keywords.includes("睡眠"));

  const manifest = JSON.parse(fs.readFileSync(result.manifestPath, "utf8"));
  assert.equal(manifest.config.generated, true);
  assert.equal(manifest.profile_id, "weibo-999999");
  assert.equal(manifest.distill.validation.status, "pass");
  assert.equal(manifest.quality_gate.status, "warn");
  assert.ok(manifest.quality_gate.warnings.includes("suggested_config_needs_review"));
});

test("answers a question through a generated author judgment profile", () => {
  const posts = normalizeWeiboRaw(sampleRaw(), { authorHandle: "sample" });
  const units = extractJudgmentUnits(posts, config);
  const maps = buildEvidenceMaps(units, config);
  const profile = buildProfile(posts, units, maps, config, { authorHandle: "sample" }, sampleRaw());

  const answer = answerQuestion({
    question: "现在买房主要要看什么？",
    profile,
    units,
    config
  });

  assert.equal(answer.question_classification, "real_estate");
  assert.equal(answer.question_classification_label, "房产 / 城市 / 资产配置");
  assert.ok(answer.likely_judgment_model);
  assert.ok(answer.reasoned_answer.includes("直接回答："));
  assert.ok(answer.reasoned_answer.includes("证据链："));
  assert.ok(!answer.reasoned_answer.includes("Direct answer:"));
  assert.ok(!answer.reasoned_answer.includes("Evidence trace:"));
  assert.ok(!answer.reasoned_answer.includes("Confidence:"));
  assert.ok(!answer.reasoned_answer.includes("This is a corpus-backed"));
  assert.ok(answer.key_variables.includes("city_opportunity"));
  assert.ok(answer.key_variable_labels.includes("城市机会"));
  assert.ok(answer.evidence_trace.length >= 1);
  assert.ok(answer.boundaries_and_confidence.boundaries.length >= 1);
  assert.equal(answer.boundaries_and_confidence.confidence_label, "低");
});

test("refuses unsupported questions instead of defaulting to the largest domain", () => {
  const posts = normalizeWeiboRaw(sampleRaw(), { authorHandle: "sample" });
  const units = extractJudgmentUnits(posts, config);
  const maps = buildEvidenceMaps(units, config);
  const profile = buildProfile(posts, units, maps, config, { authorHandle: "sample" }, sampleRaw());

  const answer = answerQuestion({
    question: "今天午饭吃什么比较好？",
    profile,
    units,
    config
  });

  assert.equal(answer.question_classification, "general");
  assert.equal(answer.question_classification_label, "通用问题");
  assert.equal(answer.likely_judgment_model, null);
  assert.equal(answer.action_tendency, "拒答或降低置信度");
  assert.equal(answer.boundaries_and_confidence.confidence, "low");
});

test("runs validation cases against answer engine outputs", () => {
  const posts = normalizeWeiboRaw(sampleRaw(), { authorHandle: "sample" });
  const units = extractJudgmentUnits(posts, config);
  const maps = buildEvidenceMaps(units, config);
  const profile = buildProfile(posts, units, maps, config, { authorHandle: "sample" }, sampleRaw());
  const report = runValidationCases({
    profile,
    units,
    config,
    cases: [
      {
        case_id: "sample_real_estate_001",
        question: "现在买房主要看什么？",
        expected_models: ["model_real_estate"],
        expected_variables: ["city_opportunity", "exit_cost"],
        must_not_include: ["博主一定会认为"],
        pass_criteria: ["cites evidence units", "states confidence boundary", "readable reasoning"]
      }
    ]
  });

  assert.equal(report.status, "pass");
  assert.equal(report.counts.cases, 1);
  assert.equal(report.results[0].status, "pass");
});

test("generates baseline validation cases from an author profile", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ajm-validation-cases-"));
  const posts = normalizeWeiboRaw(sampleRaw(), { authorHandle: "sample" });
  const units = extractJudgmentUnits(posts, config);
  const maps = buildEvidenceMaps(units, config);
  const profile = buildProfile(posts, units, maps, config, { authorHandle: "sample" }, sampleRaw());
  const profilePath = path.join(tmp, "profile.json");
  const outPath = path.join(tmp, "validation-cases.json");
  fs.writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`);

  const cases = generateValidationCases({ profile, config, maxDomains: 2, casePrefix: "sample" });
  assert.equal(cases.length, 3);
  assert.ok(cases.some((testCase) => testCase.case_id === "sample_real_estate_baseline"));
  assert.ok(cases.some((testCase) => testCase.case_id === "sample_unsupported_boundary"));
  assert.ok(cases.every((testCase) => Array.isArray(testCase.pass_criteria) && testCase.pass_criteria.length > 0));

  const generated = generateValidationCasesFromFiles({
    profilePath,
    configPath: path.join(process.cwd(), "configs/weibo.default.json"),
    outPath,
    maxDomains: 2,
    casePrefix: "file_sample"
  });
  assert.equal(generated.outPath, outPath);
  assert.equal(generated.cases, 3);
  assert.ok(fs.existsSync(outPath));

  const report = runValidationCases({
    cases: JSON.parse(fs.readFileSync(outPath, "utf8")),
    profile,
    units,
    config
  });
  assert.equal(report.status, "pass");
  assert.equal(report.counts.cases, 3);
});

test("applies validation case results back into the author profile", () => {
  const posts = normalizeWeiboRaw(sampleRaw(), { authorHandle: "sample" });
  const units = extractJudgmentUnits(posts, config);
  const maps = buildEvidenceMaps(units, config);
  const profile = buildProfile(posts, units, maps, config, { authorHandle: "sample" }, sampleRaw());
  const validationReport = runValidationCases({
    profile,
    units,
    config,
    cases: [
      {
        case_id: "sample_real_estate_001",
        question: "现在买房主要看什么？",
        expected_models: ["model_real_estate"],
        expected_variables: ["city_opportunity"],
        pass_criteria: ["cites evidence units"]
      }
    ]
  });

  const updated = applyValidationResultsToProfile(profile, validationReport, {
    validationId: "validation_test",
    generatedAt: "2026-06-20T00:00:00.000Z"
  });

  assert.equal(updated.validation_results.length, 1);
  assert.equal(updated.validation_results[0].validation_id, "validation_test");
  assert.equal(updated.validation_results[0].status, "pass");
  assert.equal(updated.update_history.at(-1).event, "validation_results_applied");
});

test("fails validation cases when expected variables are missing", () => {
  const posts = normalizeWeiboRaw(sampleRaw(), { authorHandle: "sample" });
  const units = extractJudgmentUnits(posts, config);
  const maps = buildEvidenceMaps(units, config);
  const profile = buildProfile(posts, units, maps, config, { authorHandle: "sample" }, sampleRaw());
  const report = runValidationCases({
    profile,
    units,
    config,
    cases: [
      {
        case_id: "sample_missing_variable",
        question: "现在买房主要看什么？",
        expected_models: ["model_real_estate"],
        expected_variables: ["nonexistent_variable"]
      }
    ]
  });

  assert.equal(report.status, "fail");
  assert.equal(report.counts.failed, 1);
  assert.ok(report.results[0].failures.some((failure) => failure.includes("expected variables missing")));
});

test("validates generated AJM artifacts through public artifact shapes", () => {
  const posts = normalizeWeiboRaw(sampleRaw(), { authorHandle: "sample" });
  const units = extractJudgmentUnits(posts, config);
  const maps = buildEvidenceMaps(units, config);
  const profile = buildProfile(posts, units, maps, config, { authorHandle: "sample" }, sampleRaw());

  const report = validateArtifacts({ posts, units, evidenceMaps: maps, profile });

  assert.equal(report.status, "pass");
  assert.equal(report.profile_id, "weibo-123456");
  assert.equal(report.counts.posts, 3);
  assert.ok(report.counts.mental_models >= 1);
  assert.ok(report.domains.real_estate >= 1);
});

test("builds a review report for generated AJM artifacts", () => {
  const posts = normalizeWeiboRaw(sampleRaw(), { authorHandle: "sample" });
  const units = extractJudgmentUnits(posts, config);
  const maps = buildEvidenceMaps(units, config);
  const profile = buildProfile(posts, units, maps, config, { authorHandle: "sample" }, sampleRaw());

  const report = buildReviewReport({ posts, units, evidenceMaps: maps, profile });

  assert.equal(report.profile_id, "weibo-123456");
  assert.equal(report.validation.status, "pass");
  assert.equal(report.counts.posts, 3);
  assert.ok(report.domains.some((domain) => domain.domain === "real_estate"));
  assert.ok(report.domains.find((domain) => domain.domain === "real_estate").top_evidence_units.length >= 1);
  assert.ok(report.risks.includes("validation_results_not_embedded_in_profile"));
});

test("fails validation when an evidence excerpt is not grounded in the source post", () => {
  const posts = normalizeWeiboRaw(sampleRaw(), { authorHandle: "sample" });
  const units = [
    {
      unit_id: "unit_000001",
      source_post_id: "A1",
      domain: "real_estate",
      claim: "Housing depends on city opportunity.",
      variables: ["city_opportunity"],
      evidence_excerpt: "这句证据并不存在于原微博",
      evidence_strength: "direct",
      confidence: "high"
    }
  ];
  const maps = [
    {
      domain: "real_estate",
      core_judgment: "Housing decisions depend on city opportunity.",
      supporting_units: ["unit_000001"],
      conflicting_units: [],
      key_variables: ["city_opportunity"],
      boundary: ["Corpus-backed only."],
      confidence: "medium"
    }
  ];
  const profile = {
    profile_id: "weibo-123456",
    platform: "weibo",
    author_id: "123456",
    coverage_summary: {},
    domain_map: { real_estate: { unit_count: 1, evidence_strength: "direct" } },
    mental_models: [
      {
        id: "model_real_estate",
        domains: ["real_estate"],
        evidence_unit_ids: ["unit_000001"],
        limitations: ["Corpus-backed only."]
      }
    ],
    decision_heuristics: [{ id: "heuristic_real_estate" }],
    anti_patterns: [],
    honest_boundaries: ["Do not imitate persona."],
    evidence_map_refs: ["evidence-maps/real_estate.json"],
    validation_results: [],
    update_history: []
  };

  const report = validateArtifacts({ posts, units, evidenceMaps: maps, profile });

  assert.equal(report.status, "fail");
  assert.ok(report.errors.some((error) => error.includes("evidence_excerpt is not grounded")));
});

test("supports arbitrary Weibo authors through a custom domain config", () => {
  const customConfig = {
    version: "0.1.0",
    platform: "weibo",
    domains: {
      cooking: {
        name: "Cooking and kitchen decisions",
        keywords: ["烘焙", "面包", "发酵", "烤箱"],
        variables: ["temperature", "fermentation_time", "ingredient_ratio"],
        model_template: "Judges cooking by temperature control, fermentation time, and ingredient ratios."
      }
    },
    anti_pattern_keywords: {
      shortcut_over_process: ["偷懒", "省步骤"]
    }
  };
  const raw = {
    collectedAt: "2026-06-22T00:00:00.000Z",
    target: "https://weibo.com/u/999999",
    rows: [
      {
        id: "B1",
        created_at: "2026-06-22 08:00",
        text: "做面包不要偷懒，发酵时间和烤箱温度比玄学配方重要。",
        url: "https://weibo.com/999999/B1"
      }
    ]
  };

  const posts = normalizeWeiboRaw(raw, { authorHandle: "baker" });
  const units = extractJudgmentUnits(posts, customConfig);
  const maps = buildEvidenceMaps(units, customConfig);
  const profile = buildProfile(posts, units, maps, customConfig, { authorHandle: "baker" }, raw);

  assert.equal(profile.profile_id, "weibo-999999");
  assert.equal(units[0].domain, "cooking");
  assert.deepEqual(units[0].variables, ["temperature", "fermentation_time", "ingredient_ratio"]);
  assert.ok(maps[0].core_judgment.includes("Recurring cooking judgment"));
  assert.ok(maps[0].core_judgment.includes("fermentation_time"));
});

test("suggests a starter domain config from an arbitrary Weibo corpus", () => {
  const raw = {
    collectedAt: "2026-06-22T00:00:00.000Z",
    target: "https://weibo.com/u/999999",
    rows: [
      {
        id: "C1",
        created_at: "2026-06-22 08:00",
        text: "做面包不要偷懒，发酵时间和烤箱温度比玄学配方重要。",
        url: "https://weibo.com/999999/C1"
      },
      {
        id: "C2",
        created_at: "2026-06-22 09:00",
        text: "烘焙失败先看面粉吸水、发酵状态和烤箱温度，不要只怪配方。",
        url: "https://weibo.com/999999/C2"
      },
      {
        id: "C3",
        created_at: "2026-06-22 10:00",
        text: "训练计划别迷信打卡，力量增长、睡眠恢复和动作质量更重要。",
        url: "https://weibo.com/999999/C3"
      },
      {
        id: "C4",
        created_at: "2026-06-22 11:00",
        text: "健身减脂要看饮食执行、力量训练和睡眠，不要只看体重波动。",
        url: "https://weibo.com/999999/C4"
      }
    ]
  };

  const suggestion = suggestWeiboConfig(raw, { authorHandle: "mixed-author", maxDomains: 2 });
  const domains = Object.values(suggestion.config.domains);
  const allKeywords = domains.flatMap((domain) => domain.keywords);

  assert.equal(suggestion.config.platform, "weibo");
  assert.equal(domains.length, 2);
  assert.ok(allKeywords.includes("发酵"));
  assert.ok(allKeywords.includes("烤箱"));
  assert.ok(allKeywords.includes("力量"));
  assert.ok(allKeywords.includes("睡眠"));
  assert.ok(domains.every((domain) => domain.variables.length >= 3));
  assert.ok(suggestion.review_notes.some((note) => note.includes("starter config")));
});

test("exports normalized posts into LLM extraction batches", () => {
  const posts = normalizeWeiboRaw(sampleRaw(), { authorHandle: "sample" });
  const requests = createBatchRequests(posts, config, { batchSize: 2, batchPrefix: "sample" });

  assert.equal(requests.length, 2);
  assert.equal(requests[0].batch_id, "sample_00001");
  assert.equal(requests[0].posts.length, 2);
  assert.equal(requests[1].posts.length, 1);
  assert.ok(requests[0].prompt.includes("Configured domains"));
  assert.ok(requests[0].prompt.includes("source_post_id"));
});

test("imports LLM extraction results into canonical judgment units", () => {
  const posts = normalizeWeiboRaw(sampleRaw(), { authorHandle: "sample" });
  const resultRows = [
    {
      batch_id: "sample_00001",
      judgment_units: [
        {
          source_post_id: "A1",
          domain: "real_estate",
          claim: "Housing judgment should consider city opportunity, rent-to-price ratio, and exit cost.",
          object: "housing decision",
          stance: "tool_view",
          variables: ["city_opportunity", "rent_to_price_ratio", "exit_cost"],
          causal_chain: ["old price extrapolation", "ignores current constraints", "bad housing decision"],
          decision_rule: "Evaluate housing by current variables rather than past price gains.",
          anti_patterns: ["old_rule_extrapolation"],
          confidence: "high",
          evidence_strength: "direct",
          evidence_excerpt: "买房不能只看过去涨不涨，要看城市机会、租售比和退出成本。"
        }
      ]
    }
  ];

  const imported = importExtractionResults({ posts, resultRows, unitPrefix: "llm_unit" });

  assert.deepEqual(imported.errors, []);
  assert.equal(imported.units.length, 1);
  assert.equal(imported.units[0].unit_id, "llm_unit_000001");
  assert.equal(imported.units[0].source_url, "https://weibo.com/123456/A1");
  assert.deepEqual(imported.units[0].variables, ["city_opportunity", "rent_to_price_ratio", "exit_cost"]);
});

test("parses fenced model JSON responses", () => {
  const parsed = parseModelJson("```json\n{\"batch_id\":\"b1\",\"judgment_units\":[]}\n```");
  assert.equal(parsed.batch_id, "b1");
  assert.deepEqual(parsed.judgment_units, []);
});

test("runs LLM extraction batches with resume behavior", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ajm-runner-"));
  const posts = normalizeWeiboRaw(sampleRaw(), { authorHandle: "sample" });
  const requests = createBatchRequests(posts, config, { batchSize: 1, batchPrefix: "sample" });
  const requestsPath = path.join(tmp, "requests.jsonl");
  const resultsPath = path.join(tmp, "results.jsonl");
  fs.writeFileSync(requestsPath, `${requests.map((row) => JSON.stringify(row)).join("\n")}\n`);
  fs.writeFileSync(resultsPath, `${JSON.stringify({ batch_id: "sample_00001", judgment_units: [] })}\n`);

  const seen = [];
  const summary = await runExtractionBatchRequestsFromFiles({
    requestsPath,
    resultsPath,
    limit: 1,
    callBatch: async (request) => {
      seen.push(request.batch_id);
      return {
        batch_id: request.batch_id,
        judgment_units: [
          {
            source_post_id: request.posts[0].post_id,
            domain: "general",
            claim: "Candidate judgment claim.",
            evidence_excerpt: request.posts[0].text
          }
        ]
      };
    }
  });

  assert.deepEqual(seen, ["sample_00002"]);
  assert.equal(summary.skipped, 1);
  assert.equal(summary.processed, 1);
  assert.equal(summary.remaining, 1);

  const resultLines = fs.readFileSync(resultsPath, "utf8").trim().split(/\n/).map((line) => JSON.parse(line));
  assert.equal(resultLines.length, 2);
  assert.equal(resultLines[1].batch_id, "sample_00002");
});

test("rebuilds profile and evidence maps from imported LLM judgment units", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ajm-rebuild-"));
  const posts = normalizeWeiboRaw(sampleRaw(), { authorHandle: "sample" });
  const imported = importExtractionResults({
    posts,
    unitPrefix: "llm_unit",
    resultRows: [
      {
        batch_id: "sample_00001",
        judgment_units: [
          {
            source_post_id: "A1",
            domain: "real_estate",
            claim: "Housing judgment should consider city opportunity, rent-to-price ratio, and exit cost.",
            object: "housing decision",
            stance: "tool_view",
            variables: ["city_opportunity", "rent_to_price_ratio", "exit_cost"],
            causal_chain: ["old price extrapolation", "ignores current constraints", "bad housing decision"],
            decision_rule: "Evaluate housing by current variables rather than past price gains.",
            anti_patterns: ["old_rule_extrapolation"],
            confidence: "high",
            evidence_strength: "direct",
            evidence_excerpt: "买房不能只看过去涨不涨，要看城市机会、租售比和退出成本。"
          }
        ]
      }
    ]
  });
  const postsPath = path.join(tmp, "posts.json");
  const unitsPath = path.join(tmp, "llm-units.json");
  fs.writeFileSync(postsPath, JSON.stringify(posts, null, 2));
  fs.writeFileSync(unitsPath, JSON.stringify(imported.units, null, 2));

  const result = buildArtifactsFromUnits({
    postsPath,
    unitsPath,
    authorId: "123456",
    authorHandle: "sample",
    outDir: path.join(tmp, "data"),
    configPath: path.join(process.cwd(), "configs/weibo.default.json")
  });

  assert.equal(result.slug, "weibo-123456");
  assert.equal(result.units, 1);
  assert.equal(result.evidenceMaps, 1);
  assert.ok(fs.existsSync(result.profilePath));
  assert.ok(fs.existsSync(result.evidenceMapsPath));

  const profile = JSON.parse(fs.readFileSync(result.profilePath, "utf8"));
  assert.equal(profile.mental_models[0].id, "model_real_estate");
  assert.equal(profile.mental_models[0].evidence_unit_ids[0], "llm_unit_000001");
  assert.ok(profile.mental_models[0].definition.includes("Recurring decision rule"));
  assert.ok(profile.mental_models[0].definition.includes("Evaluate housing by current variables"));
  assert.equal(profile.decision_heuristics[0].default_action, "Evaluate housing by current variables rather than past price gains.");
});
