const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  normalizeWeiboRaw,
  normalizeXRaw,
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
const {
  discoverConceptCandidates,
  exportConceptReviewPack,
  applyConceptReviewToProfileFromFiles
} = require("../scripts/lib/concept-discovery");
const {
  returnsForSeries,
  contextFromRows,
  symbolsForQuestion,
  futuCodeForSymbol,
  parseJsonFromMixedOutput
} = require("../scripts/lib/market-context");
const { matchCoreAssetRoute, forcedDomainForQuestion } = require("../scripts/lib/core-assets");

const config = require("../configs/weibo.default.json");
const tjConfig = require("../configs/x-tj-research.json");

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

test("normalizes X raw tweets into canonical posts", () => {
  const raw = {
    source: "twitterapi.io",
    account: "TJ_Research",
    user_id: "1620475218627121153",
    user_name: "投资TALK君",
    fetched_at_utc: "2026-06-14T08:45:13.434045+00:00",
    cutoff_utc: "2025-06-14T00:00:00+00:00",
    until_utc: "2026-06-14T00:00:00+00:00",
    tweets: [
      {
        id: "2065588508153065544",
        url: "https://x.com/TJ_Research/status/2065588508153065544",
        text: "AI算力和电力约束仍然是重要主线。",
        createdAt: "Sat Jun 13 00:14:11 +0000 2026",
        likeCount: 10,
        replyCount: 2,
        retweetCount: 3,
        quoteCount: 1,
        viewCount: 1000,
        isReply: false,
        author: {
          id: "1620475218627121153",
          userName: "TJ_Research",
          name: "投资TALK君"
        }
      }
    ]
  };

  const posts = normalizeXRaw(raw);

  assert.equal(posts.length, 1);
  assert.equal(posts[0].platform, "x");
  assert.equal(posts[0].author_id, "1620475218627121153");
  assert.equal(posts[0].author_handle, "TJ_Research");
  assert.equal(posts[0].created_at, "2026-06-13T00:14:11.000Z");
  assert.equal(posts[0].engagement.likes, 10);
  assert.equal(posts[0].engagement.reposts, 4);
  assert.equal(posts[0].capture.coverage_note, "2025-06-14T00:00:00+00:00 to 2026-06-14T00:00:00+00:00");
});

test("selects semiconductor market symbols for semiconductor questions", () => {
  const symbols = symbolsForQuestion("如何看待7月美股半导体板块？").map((item) => item.symbol);

  assert.ok(symbols.includes("SOXX"));
  assert.ok(symbols.includes("SMH"));
  assert.ok(symbols.includes("NVDA"));
  assert.ok(symbols.includes("AMD"));
  assert.ok(symbols.includes("AVGO"));
});

test("selects topic-specific market symbols for macro and China asset questions", () => {
  const macro = symbolsForQuestion("Fed降息后流动性怎么看？").map((item) => item.symbol);
  const china = symbolsForQuestion("中国资产和中概股还有机会吗？").map((item) => item.symbol);
  const generic = symbolsForQuestion("portfolio risk budget").map((item) => item.symbol);

  assert.ok(macro.includes("^TNX"));
  assert.ok(macro.includes("TLT"));
  assert.ok(china.includes("KWEB"));
  assert.ok(china.includes("FXI"));
  assert.ok(generic.includes("SPY"));
  assert.ok(!generic.includes("SOXX"));
});

test("selects US index symbols for QQQ and Nasdaq questions", () => {
  const symbols = symbolsForQuestion("7月份美股QQQ会怎么走？").map((item) => item.symbol);

  assert.deepEqual(symbols.slice(0, 4), ["QQQ", "SPY", "RSP", "IWM"]);
  assert.ok(symbols.includes("TLT"));
});

test("core asset objects are forced routable before keyword scoring", () => {
  const cases = [
    ["7月份美股QQQ会怎么走？", "us_index", "macro_fed_liquidity"],
    ["SPY 和标普下半年怎么看？", "us_index", "macro_fed_liquidity"],
    ["大科技还能继续买吗？", "big_tech", "big_tech_software_cloud"],
    ["半导体板块还能追吗？", "semiconductor", "ai_semis_infrastructure"],
    ["BTC 这里还能配置吗？", "crypto", "crypto_stablecoin"],
    ["港股中概还有机会吗？", "china_assets", "china_policy_geopolitics"]
  ];

  for (const [question, routeId, domainId] of cases) {
    assert.equal(matchCoreAssetRoute(question)?.id, routeId);
    assert.equal(forcedDomainForQuestion(question, tjConfig)?.domainId, domainId);
  }
});

test("maps market symbols to Futu codes and parses Skill JSON with logs", () => {
  assert.equal(futuCodeForSymbol("NVDA"), "US.NVDA");
  assert.equal(futuCodeForSymbol("BTC-USD"), "CC.BTC");
  assert.equal(futuCodeForSymbol("^VIX"), null);

  const payload = parseJsonFromMixedOutput([
    "2026-06-21 00:00:00 | log line",
    "{\"code\":\"US.NVDA\",\"data\":[{\"close\":210.69}]}"
  ].join("\n"));

  assert.equal(payload.code, "US.NVDA");
  assert.equal(payload.data[0].close, 210.69);
});

test("summarizes market rows into factual AJM context", () => {
  const now = Date.UTC(2026, 5, 21);
  const series = [
    { time: now - 90 * 24 * 60 * 60 * 1000, close: 100 },
    { time: now - 30 * 24 * 60 * 60 * 1000, close: 120 },
    { time: now - 1 * 24 * 60 * 60 * 1000, close: 130 },
    { time: now, close: 132 }
  ];
  const row = {
    symbol: "NVDA",
    name: "NVIDIA",
    ...returnsForSeries(series)
  };
  const result = contextFromRows({
    question: "如何看待7月美股半导体板块？",
    rows: [row],
    provider: "test-provider",
    asOf: "2026-06-21T00:00:00.000Z"
  });

  assert.equal(row.oneDayPct.toFixed(1), "1.5");
  assert.equal(row.oneMonthPct.toFixed(1), "10.0");
  assert.ok(result.context.includes("数据来源：test-provider"));
  assert.ok(result.context.includes("NVDA 最新 132.00"));
  assert.ok(result.context.includes("事件/基本面仍需补充"));
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

test("runs pipeline for X raw tweets without labeling the profile as weibo", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ajm-x-"));
  const rawPath = path.join(tmp, "tj-research.json");
  const configPath = path.join(tmp, "x.config.json");
  const raw = {
    source: "twitterapi.io",
    account: "TJ_Research",
    user_id: "1620475218627121153",
    user_name: "投资TALK君",
    tweets: [
      {
        id: "T1",
        url: "https://x.com/TJ_Research/status/T1",
        text: "AI算力、电力和半导体资本开支是重要主线，需要结合估值和风险。",
        createdAt: "Sat Jun 13 00:14:11 +0000 2026",
        likeCount: 10,
        replyCount: 2,
        retweetCount: 3,
        quoteCount: 1,
        author: { id: "1620475218627121153", userName: "TJ_Research" }
      }
    ]
  };
  const xConfig = {
    version: "0.1.0",
    platform: "x",
    domains: {
      ai_semis_infrastructure: {
        name: "AI / 半导体 / 基础设施",
        keywords: ["AI", "算力", "电力", "半导体", "资本开支"],
        variables: ["ai_demand", "power_constraint", "capex_cycle", "valuation", "risk_reward"],
        model_template: "围绕 AI 需求、算力基础设施、电力约束、资本开支和估值风险判断产业机会。"
      }
    },
    anti_pattern_keywords: {}
  };
  fs.writeFileSync(rawPath, JSON.stringify(raw, null, 2));
  fs.writeFileSync(configPath, JSON.stringify(xConfig, null, 2));

  const result = runPipeline({
    rawPath,
    outDir: tmp,
    configPath
  });
  const profile = JSON.parse(fs.readFileSync(result.profilePath, "utf8"));

  assert.equal(result.slug, "x-1620475218627121153");
  assert.equal(profile.platform, "x");
  assert.equal(profile.profile_id, "x-1620475218627121153");
  assert.equal(profile.coverage_summary.source_target, "https://x.com/TJ_Research");
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

test("builds an author unit with v2.1 concept discovery review artifacts", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ajm-full-build-concepts-"));
  const rawPath = path.join(tmp, "raw-index.json");
  fs.writeFileSync(rawPath, JSON.stringify(sampleRaw(), null, 2));

  const result = buildWeiboAuthorUnit({
    rawPath,
    authorHandle: "sample",
    outDir: path.join(tmp, "author-unit"),
    configPath: path.join(process.cwd(), "configs/weibo.default.json"),
    discoverConcepts: true,
    minConceptEvidenceUnits: 1,
    minPosts: 1,
    minJudgmentUnits: 1,
    minMentalModels: 1
  });

  const manifest = JSON.parse(fs.readFileSync(result.manifestPath, "utf8"));
  assert.ok(manifest.stages.includes("concept-discovery"));
  assert.ok(manifest.stages.includes("apply-concept-review"));
  assert.ok(fs.existsSync(path.join(tmp, "author-unit", "review", "concepts", "concept-candidates.json")));
  assert.ok(fs.existsSync(path.join(tmp, "author-unit", "review", "concepts", "concept-review-template.json")));
  assert.ok(fs.existsSync(path.join(tmp, "author-unit", "review", "concepts", "concept-review.md")));
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

test("gives directional real-estate conclusions without claiming future facts", () => {
  const posts = normalizeWeiboRaw(sampleRaw(), { authorHandle: "sample" });
  const units = extractJudgmentUnits(posts, config);
  const maps = buildEvidenceMaps(units, config);
  const profile = buildProfile(posts, units, maps, config, { authorHandle: "sample" }, sampleRaw());

  const answer = answerQuestion({
    question: "未来杭州的房价会如何？",
    profile,
    units,
    config
  });

  assert.equal(answer.question_classification, "real_estate");
  assert.ok(answer.direct_answer.includes("不能直接给"));
  assert.ok(answer.direct_answer.includes("偏谨慎"));
  assert.ok(answer.direct_answer.includes("实时成交"));
});

test("classifies optical sector trading questions as covered for trader configs", () => {
  const traderConfig = require("../configs/weibo-1357064103.jianfang.json");
  const raw = {
    collectedAt: "2026-06-21T00:00:00.000Z",
    target: "https://weibo.com/u/1357064103",
    rows: [
      {
        id: "T1",
        bid: "T1",
        created_at: "2026-05-30 15:00",
        text: "易中天今天再次同时创历史新高。很多人认为是抱团，但要看光通信和算力主线的产业逻辑是否继续成立。",
        url: "https://weibo.com/1357064103/T1"
      },
      {
        id: "T2",
        bid: "T2",
        created_at: "2026-05-31 10:00",
        text: "强逻辑和上升趋势中不要轻易猜顶，但加速区不要追涨，回踩时再看低吸机会。",
        url: "https://weibo.com/1357064103/T2"
      },
      {
        id: "T3",
        bid: "T3",
        created_at: "2026-05-31 11:00",
        text: "仓位和止损必须放在前面，不能用继续持有替代风控。",
        url: "https://weibo.com/1357064103/T3"
      }
    ]
  };
  const posts = normalizeWeiboRaw(raw, { authorHandle: "trader-jianfang" });
  const units = extractJudgmentUnits(posts, traderConfig);
  const maps = buildEvidenceMaps(units, traderConfig);
  const profile = buildProfile(posts, units, maps, traderConfig, { authorHandle: "trader-jianfang" }, raw);

  const specificAnswer = answerQuestion({
    question: "光板块的易中天3只标的还能继续买，并持有到7月底吗？",
    profile,
    units,
    config: traderConfig
  });
  const broadAnswer = answerQuestion({
    question: "光板块还能继续买吗？",
    profile,
    units,
    config: traderConfig
  });

  assert.equal(specificAnswer.question_classification, "ai_tech_industry_logic");
  assert.equal(broadAnswer.question_classification, "ai_tech_industry_logic");
  assert.ok(specificAnswer.direct_answer.includes("不是简单问“能不能买”"));
  assert.ok(specificAnswer.direct_answer.includes("实时交易判断"));
  assert.ok(specificAnswer.evidence_trace.some((item) => item.evidence_excerpt.includes("易中天") || item.evidence_excerpt.includes("光通信")));
});

test("routes semantic aliases through concept triggers and boundaries", () => {
  const traderConfig = require("../configs/weibo-1357064103.jianfang.json");
  const raw = {
    collectedAt: "2026-06-21T00:00:00.000Z",
    target: "https://weibo.com/u/1357064103",
    rows: [
      {
        id: "C1",
        bid: "C1",
        created_at: "2026-05-30 15:00",
        text: "易中天今天再次同时创历史新高。很多人认为是抱团，但抱团为何不去抱白酒？还是要看光通信和算力主线的产业逻辑。",
        url: "https://weibo.com/1357064103/C1"
      },
      {
        id: "C2",
        bid: "C2",
        created_at: "2026-05-31 10:00",
        text: "强逻辑和上升趋势中不要轻易猜顶，但加速区不要追涨，回踩时再看低吸机会。",
        url: "https://weibo.com/1357064103/C2"
      }
    ]
  };
  const posts = normalizeWeiboRaw(raw, { authorHandle: "trader-jianfang" });
  const units = extractJudgmentUnits(posts, traderConfig);
  const maps = buildEvidenceMaps(units, traderConfig);
  const profile = buildProfile(posts, units, maps, traderConfig, { authorHandle: "trader-jianfang" }, raw);

  const answer = answerQuestion({
    question: "易中天还能继续买，并持有到7月底吗？",
    profile,
    units,
    config: traderConfig
  });

  assert.ok(Array.isArray(profile.concepts));
  assert.ok(profile.concepts.some((concept) => concept.id === "optical_ai_chain"));
  assert.equal(answer.matched_concept?.id, "optical_ai_chain");
  assert.ok(answer.matched_concept.aliases.includes("易中天"));
  assert.ok(answer.trigger_conditions.some((item) => item.includes("继续买") || item.includes("持有")));
  assert.ok(answer.boundary_conditions.some((item) => item.includes("实时") || item.includes("日期")));
  assert.equal(answer.question_classification, "ai_tech_industry_logic");
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

test("routes TJ Research QQQ index outlook questions to macro liquidity model", () => {
  const profile = {
    profile_id: "x-test-tj",
    platform: "x",
    domain_map: {
      macro_fed_liquidity: { unit_count: 30 }
    },
    mental_models: [
      {
        id: "model_macro_fed_liquidity",
        domains: ["macro_fed_liquidity"],
        variables: tjConfig.domains.macro_fed_liquidity.variables,
        evidence_unit_ids: ["tj_macro_1", "tj_macro_2", "tj_macro_3"],
        limitations: ["Real-time factual claims require external verification."]
      }
    ],
    honest_boundaries: ["This is a corpus-backed judgment approximation."]
  };
  const units = [
    {
      unit_id: "tj_macro_1",
      source_post_id: "x1",
      created_at: "2026-06-01",
      claim: "美股指数估值和 EPS 是判断 QQQ 后市的重要变量。",
      evidence_excerpt: "美股指数估值(Forward PE)没有泡沫，因为未来一年预期盈利增速很快。"
    },
    {
      unit_id: "tj_macro_2",
      source_post_id: "x2",
      created_at: "2026-06-02",
      claim: "纳指估值偏高时要考虑回调和降 beta。",
      evidence_excerpt: "纳指估值30X，继续每往上涨2%，减X仓位，或移动止盈。"
    },
    {
      unit_id: "tj_macro_3",
      source_post_id: "x3",
      created_at: "2026-06-03",
      claim: "美股走势要结合通胀、利率、流动性和资产价格影响。",
      evidence_excerpt: "美股的核心是基本面大于宏观，但情绪面太高，宏观风险就会凸显。"
    }
  ];

  const answer = answerQuestion({
    question: "7月份美股QQQ会怎么走？",
    profile,
    units,
    config: tjConfig
  });

  assert.equal(answer.question_classification, "macro_fed_liquidity");
  assert.equal(answer.likely_judgment_model.id, "model_macro_fed_liquidity");
  assert.match(answer.direct_answer, /QQQ|纳指/);
  assert.doesNotMatch(answer.direct_answer, /不支持/);
  assert.ok(answer.evidence_trace.length >= 3);
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
  assert.ok(requests[0].prompt.includes("trigger_conditions"));
  assert.ok(requests[0].prompt.includes("boundary_conditions"));
  assert.ok(requests[0].prompt.includes("counterexamples"));
  assert.ok(requests[0].prompt.includes("time_scope"));
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
          concept_ids: ["housing_asset_allocation"],
          trigger_conditions: ["question asks whether past price gains should guide buying"],
          boundary_conditions: ["requires current local market verification"],
          counterexamples: ["do not apply to short-term rental choices"],
          time_scope: "current corpus period",
          confidence_reason: "explicit variables and direct evidence",
          applicability: "housing purchase and allocation questions",
          misuse_risks: ["using it as a real-time price prediction"],
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
  assert.deepEqual(imported.units[0].concept_ids, ["housing_asset_allocation"]);
  assert.deepEqual(imported.units[0].trigger_conditions, ["question asks whether past price gains should guide buying"]);
  assert.deepEqual(imported.units[0].boundary_conditions, ["requires current local market verification"]);
  assert.deepEqual(imported.units[0].counterexamples, ["do not apply to short-term rental choices"]);
  assert.equal(imported.units[0].time_scope, "current corpus period");
  assert.equal(imported.units[0].confidence_reason, "explicit variables and direct evidence");
  assert.equal(imported.units[0].applicability, "housing purchase and allocation questions");
  assert.deepEqual(imported.units[0].misuse_risks, ["using it as a real-time price prediction"]);
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

test("discovers concept cards from repeated semantic judgment units", () => {
  const units = [
    {
      unit_id: "llm_unit_000001",
      source_post_id: "P1",
      created_at: "2026-05-01",
      domain: "ai_tech_industry_logic",
      claim: "光通信和算力链仍是人工智能主线。",
      object: "光通信算力链",
      variables: ["industry_demand", "technology_mainline", "supply_constraint"],
      concept_ids: ["optical_ai_chain"],
      trigger_conditions: ["问题询问光通信、光模块或算力链"],
      boundary_conditions: ["需要实时行情和估值验证"],
      counterexamples: ["只问照明或摄影时不适用"],
      time_scope: "2026-05 corpus",
      confidence: "high",
      evidence_strength: "direct",
      evidence_excerpt: "光通信和算力链仍是人工智能主线。"
    },
    {
      unit_id: "llm_unit_000002",
      source_post_id: "P2",
      created_at: "2026-05-02",
      domain: "trend_structure_timing",
      claim: "光模块加速时不要追涨，回踩再看。",
      object: "光模块交易时机",
      variables: ["trend_direction", "acceleration_phase", "entry_timing"],
      concept_ids: ["optical_ai_chain"],
      trigger_conditions: ["问题询问还能不能买或继续持有"],
      boundary_conditions: ["不能给确定性买卖指令"],
      counterexamples: ["没有趋势证据时不适用"],
      confidence: "high",
      evidence_strength: "direct",
      evidence_excerpt: "光模块加速时不要追涨，回踩再看。"
    },
    {
      unit_id: "llm_unit_000003",
      source_post_id: "P3",
      created_at: "2026-05-03",
      domain: "risk_position_management",
      claim: "光板块交易要用仓位和止损约束。",
      object: "光板块仓位管理",
      variables: ["position_size", "stop_loss"],
      concept_ids: ["optical_ai_chain"],
      trigger_conditions: ["问题同时涉及标的、买入和持有期限"],
      boundary_conditions: ["不能替代个股交易计划"],
      counterexamples: ["脱离交易计划时不适用"],
      confidence: "medium",
      evidence_strength: "direct",
      evidence_excerpt: "光板块交易要用仓位和止损约束。"
    }
  ];

  const result = discoverConceptCandidates({ units, minEvidenceUnits: 3 });
  const concept = result.candidates.find((item) => item.id === "optical_ai_chain");

  assert.ok(concept);
  assert.equal(concept.quality.status, "pass");
  assert.deepEqual(concept.domains, ["ai_tech_industry_logic", "trend_structure_timing", "risk_position_management"]);
  assert.ok(concept.aliases.some((alias) => alias.includes("光")));
  assert.ok(concept.trigger_conditions.length >= 3);
  assert.ok(concept.boundary_conditions.length >= 3);
  assert.ok(concept.counterexamples.length >= 3);
  assert.deepEqual(concept.evidence_unit_ids, ["llm_unit_000001", "llm_unit_000002", "llm_unit_000003"]);
});

test("discovers concept candidates from repeated object terms without concept ids", () => {
  const units = [
    {
      unit_id: "unit_000001",
      source_post_id: "A1",
      created_at: "2025-12-01",
      domain: "real_estate",
      claim: "没有房产税，就没有房地产斩杀线。",
      object: "房地产斩杀线",
      variables: ["exit_cost", "liquidity"],
      confidence: "medium",
      evidence_strength: "direct",
      evidence_excerpt: "没有房产税，就没有房地产斩杀线。"
    },
    {
      unit_id: "unit_000002",
      source_post_id: "A2",
      created_at: "2025-12-02",
      domain: "real_estate",
      claim: "斩杀线来自房产税、信用机制和最低支付线。",
      object: "斩杀线机制",
      variables: ["exit_cost", "household_balance_sheet"],
      confidence: "medium",
      evidence_strength: "direct",
      evidence_excerpt: "斩杀线来自房产税、信用机制和最低支付线。"
    },
    {
      unit_id: "unit_000003",
      source_post_id: "A3",
      created_at: "2025-12-03",
      domain: "real_estate",
      claim: "中国房产没有清晰斩杀线，所以不能照搬美国房地产判断。",
      object: "斩杀线差异",
      variables: ["city_opportunity", "exit_cost"],
      confidence: "medium",
      evidence_strength: "direct",
      evidence_excerpt: "中国房产没有清晰斩杀线，所以不能照搬美国房地产判断。"
    }
  ];

  const result = discoverConceptCandidates({ units, minEvidenceUnits: 3 });
  const concept = result.candidates.find((item) => item.aliases.includes("斩杀线"));

  assert.ok(concept);
  assert.equal(concept.quality.status, "pass");
  assert.equal(concept.domains[0], "real_estate");
  assert.ok(concept.trigger_conditions.some((item) => item.includes("斩杀线")));
  assert.ok(concept.boundary_conditions.some((item) => item.includes("实时") || item.includes("历史语料")));
});

test("discovers trading concepts from structural signals instead of term fragments", () => {
  const units = [
    {
      unit_id: "trade_unit_000001",
      source_post_id: "T1",
      created_at: "2026-05-01",
      domain: "market_regime_mainline",
      claim: "市场还是要围绕人工智能主线，非主线反弹不能追。",
      object: "主线判断",
      variables: ["mainline_clarity", "sector_leadership", "risk_reward"],
      trigger_conditions: ["问题询问主线是否成立"],
      boundary_conditions: ["非主线反弹不能当作主线"],
      counterexamples: ["只有短线反弹但没有产业逻辑时不适用"],
      confidence: "high",
      evidence_strength: "direct",
      evidence_excerpt: "市场还是要围绕人工智能主线，非主线反弹不能追。"
    },
    {
      unit_id: "trade_unit_000002",
      source_post_id: "T2",
      created_at: "2026-05-02",
      domain: "trend_structure_timing",
      claim: "强势主线加速区不追涨，回踩或恐慌时再低吸。",
      object: "买卖时机",
      variables: ["trend_direction", "acceleration_phase", "entry_timing", "chase_risk"],
      trigger_conditions: ["问题询问还能不能买、继续买或低吸"],
      boundary_conditions: ["加速区不能无脑追涨"],
      counterexamples: ["没有回踩质量时不适用"],
      confidence: "high",
      evidence_strength: "direct",
      evidence_excerpt: "强势主线加速区不追涨，回踩或恐慌时再低吸。"
    },
    {
      unit_id: "trade_unit_000003",
      source_post_id: "T3",
      created_at: "2026-05-03",
      domain: "risk_position_management",
      claim: "能不能持有到月底，要看仓位、止损和趋势是否失效。",
      object: "持仓边界",
      variables: ["position_size", "stop_loss", "holding_period", "trend_direction"],
      trigger_conditions: ["问题询问持有到具体日期"],
      boundary_conditions: ["不能替代实时行情和个人交易计划"],
      counterexamples: ["没有止损计划时不能给持有结论"],
      confidence: "medium",
      evidence_strength: "direct",
      evidence_excerpt: "能不能持有到月底，要看仓位、止损和趋势是否失效。"
    }
  ];

  const result = discoverConceptCandidates({ units, minEvidenceUnits: 3, strategy: "trading" });
  const concept = result.candidates.find((item) => item.id === "trading_mainline_timing_risk");

  assert.ok(concept);
  assert.equal(result.version, "0.2.3");
  assert.equal(concept.discovery_source, "trading_structure");
  assert.equal(concept.name, "主线-时机-风控交易框架");
  assert.equal(concept.quality.status, "pass");
  assert.deepEqual(concept.domains, ["market_regime_mainline", "trend_structure_timing", "risk_position_management"]);
  assert.ok(concept.aliases.includes("主线"));
  assert.ok(concept.aliases.includes("低吸"));
  assert.ok(concept.aliases.includes("追涨"));
  assert.ok(concept.trigger_conditions.some((item) => item.includes("还能不能买")));
  assert.ok(concept.boundary_conditions.some((item) => item.includes("加速区")));
  assert.ok(concept.counterexamples.some((item) => item.includes("止损")));
  assert.deepEqual(concept.evidence_unit_ids, ["trade_unit_000001", "trade_unit_000002", "trade_unit_000003"]);
});

test("splits broad trading structure into stable domain concepts", () => {
  const domainSpecs = [
    {
      domain: "ai_semis_infrastructure",
      object: "AI算力半导体基础设施",
      claim: "AI算力、半导体、数据中心和电力约束需要一起判断。",
      variables: ["ai_demand", "compute_supply", "power_constraint", "valuation"],
      trigger: "问题询问 AI、算力、半导体或基础设施主线是否成立",
      boundary: "不能只因 AI 热度就忽略估值、电力和资本开支约束",
      counterexample: "只有情绪上涨但没有需求或供给证据时不适用"
    },
    {
      domain: "big_tech_software_cloud",
      object: "美股大型科技软件云",
      claim: "大型科技、软件云和 AI Agent 要看分发、企业信任和云收入。",
      variables: ["distribution", "enterprise_trust", "cloud_revenue", "margin"],
      trigger: "问题询问大型科技、软件云或 AI Agent 的投资逻辑",
      boundary: "不能只看单个产品发布就外推长期胜率",
      counterexample: "缺少云收入或企业采用证据时不适用"
    },
    {
      domain: "macro_fed_liquidity",
      object: "宏观利率Fed流动性",
      claim: "利率、美联储和流动性变化会影响资产定价和风险偏好。",
      variables: ["inflation_path", "fed_reaction_function", "liquidity_condition", "asset_price_impact"],
      trigger: "问题询问 Fed、降息、通胀、流动性或美债变化",
      boundary: "不能把单次 CPI 或 PCE 读数直接等同于政策转向",
      counterexample: "没有资产价格传导路径时不适用"
    },
    {
      domain: "company_fundamental_research",
      object: "个股基本面财报催化",
      claim: "个股判断要看财报、指引、估值、商业模式和催化。",
      variables: ["revenue_growth", "management_guidance", "valuation_multiple", "business_moat"],
      trigger: "问题询问某只个股是否能买、持有或等待财报催化",
      boundary: "不能只靠 K 线或消息面替代基本面研究",
      counterexample: "没有财报、估值或业务证据时不适用"
    },
    {
      domain: "portfolio_risk_positioning",
      object: "组合仓位风险预算止损",
      claim: "买入和持有必须结合仓位、风险预算、止损和退出计划。",
      variables: ["position_size", "risk_budget", "stop_loss", "exit_plan"],
      trigger: "问题询问仓位、加仓、减仓、止损或能否继续持有",
      boundary: "不能替代个人账户风险承受能力和交易计划",
      counterexample: "没有止损或风险预算时不能给确定性买卖结论"
    },
    {
      domain: "crypto_stablecoin",
      object: "加密稳定币金融基础设施",
      claim: "稳定币、加密金融和 CRCL 需要看采用、监管、估值和供给。",
      variables: ["stablecoin_adoption", "regulatory_risk", "valuation", "lockup_supply"],
      trigger: "问题询问稳定币、CRCL、BTC 或加密金融基础设施",
      boundary: "不能只因赛道长期空间大就忽略监管和解禁供给",
      counterexample: "只有市场情绪没有采用或监管判断时不适用"
    },
    {
      domain: "china_policy_geopolitics",
      object: "中国资产地缘政策风险",
      claim: "中国资产、港股中概和地缘风险要拆开政策、关税、出口管制和估值折价。",
      variables: ["policy_direction", "geopolitical_risk", "tariff_impact", "valuation_discount"],
      trigger: "问题询问中国资产、港股中概、关税、出口管制或地缘政策",
      boundary: "不能把单条谈判消息直接当成政策方向变化",
      counterexample: "没有政策路径或估值折价判断时不适用"
    }
  ];
  const units = domainSpecs.flatMap((spec, specIndex) =>
    [0, 1, 2].map((itemIndex) => ({
      unit_id: `domain_unit_${String(specIndex).padStart(2, "0")}_${itemIndex}`,
      source_post_id: `P${specIndex}_${itemIndex}`,
      created_at: "2026-06-01",
      domain: spec.domain,
      claim: `${spec.claim} 第${itemIndex + 1}次证据。`,
      object: spec.object,
      variables: spec.variables,
      trigger_conditions: [spec.trigger],
      boundary_conditions: [spec.boundary],
      counterexamples: [spec.counterexample],
      confidence: "high",
      evidence_strength: "direct",
      evidence_excerpt: `${spec.claim} ${spec.boundary}`
    }))
  );

  const result = discoverConceptCandidates({ units, minEvidenceUnits: 3, strategy: "trading" });
  const ids = result.candidates.map((candidate) => candidate.id);

  assert.equal(result.version, "0.2.3");
  assert.ok(ids.includes("ai_compute_semis_infrastructure"));
  assert.ok(ids.includes("us_big_tech_software_cloud"));
  assert.ok(ids.includes("macro_fed_liquidity_cycle"));
  assert.ok(ids.includes("company_fundamental_earnings_catalyst"));
  assert.ok(ids.includes("portfolio_risk_budget_stop_loss"));
  assert.ok(ids.includes("crypto_stablecoin_financial_infra"));
  assert.ok(ids.includes("china_assets_geopolitical_policy_risk"));
  assert.ok(result.candidates.every((candidate) => candidate.quality.status === "pass"));
});

test("splits Weibo trader concepts by market, timing, risk, industry, psychology, and intraday domains", () => {
  const domainSpecs = [
    {
      domain: "market_regime_mainline",
      object: "市场状态与主线方向",
      claim: "市场强弱和主线清晰度决定是否做大波段或等待。",
      variables: ["market_regime", "mainline_clarity", "sector_leadership", "risk_reward"],
      trigger: "问题询问市场主线、方向、强弱或是否值得参与",
      boundary: "主线不清或市场弱势时不能到处乱做",
      counterexample: "只有短线反弹但没有主线确认时不适用"
    },
    {
      domain: "trend_structure_timing",
      object: "趋势结构与买卖时机",
      claim: "交易时机要看趋势、回踩质量和是否处在加速区。",
      variables: ["trend_direction", "pullback_quality", "acceleration_phase", "entry_timing"],
      trigger: "问题询问还能不能买、低吸、追涨或持有到某个日期",
      boundary: "加速区不能无脑追涨",
      counterexample: "趋势失效或没有回踩质量时不适用"
    },
    {
      domain: "risk_position_management",
      object: "风险控制与仓位管理",
      claim: "风控要看止损、止盈、仓位、底仓和持有周期。",
      variables: ["stop_loss", "position_size", "core_position", "loss_control"],
      trigger: "问题询问仓位、止损、止盈、底仓或是否继续持有",
      boundary: "不能替代个人交易计划和实时行情",
      counterexample: "没有止损计划或仓位约束时不适用"
    },
    {
      domain: "ai_tech_industry_logic",
      object: "人工智能科技产业逻辑",
      claim: "AI、算力、光模块、光通信和半导体要看全球需求和业绩兑现。",
      variables: ["industry_demand", "global_cycle", "supply_constraint", "earnings_growth"],
      trigger: "问题询问 AI、算力、光模块、光通信或半导体产业主线",
      boundary: "不能把题材热度直接等同于产业逻辑",
      counterexample: "只问照明、摄影或普通光学物理时不适用"
    },
    {
      domain: "trading_psychology_execution",
      object: "交易心理与执行纪律",
      claim: "交易心理强调认知开放、执行纪律和控制贪婪恐惧。",
      variables: ["emotional_state", "execution_discipline", "cognitive_openness", "patience"],
      trigger: "问题询问交易心态、执行力、恐惧、贪婪或怀疑逻辑",
      boundary: "不能用情绪替代交易系统和证据",
      counterexample: "没有交易决策或执行语境时不适用"
    },
    {
      domain: "intraday_market_reading",
      object: "盘中观察与短线反馈",
      claim: "盘中观察通过指数、成交量、补量和主线反馈确认短线状态。",
      variables: ["intraday_strength", "volume_confirmation", "index_feedback", "market_breadth"],
      trigger: "问题询问今日看盘、早盘、尾盘、成交量、补量或盘中反馈",
      boundary: "盘中信号不能脱离更大趋势和产业逻辑",
      counterexample: "没有盘面反馈或成交量确认时不适用"
    }
  ];
  const units = domainSpecs.flatMap((spec, specIndex) =>
    [0, 1, 2].map((itemIndex) => ({
      unit_id: `weibo_trader_unit_${String(specIndex).padStart(2, "0")}_${itemIndex}`,
      source_post_id: `W${specIndex}_${itemIndex}`,
      created_at: "2026-06-01",
      domain: spec.domain,
      claim: `${spec.claim} 第${itemIndex + 1}次证据。`,
      object: spec.object,
      variables: spec.variables,
      trigger_conditions: [spec.trigger],
      boundary_conditions: [spec.boundary],
      counterexamples: [spec.counterexample],
      confidence: "high",
      evidence_strength: "direct",
      evidence_excerpt: `${spec.claim} ${spec.boundary}`
    }))
  );

  const result = discoverConceptCandidates({ units, minEvidenceUnits: 3, strategy: "trading" });
  const ids = result.candidates.map((candidate) => candidate.id);

  assert.ok(ids.includes("market_regime_mainline_direction"));
  assert.ok(ids.includes("trend_structure_entry_timing"));
  assert.ok(ids.includes("risk_position_stop_loss_discipline"));
  assert.ok(ids.includes("ai_tech_industry_logic_chain"));
  assert.ok(ids.includes("trading_psychology_execution_discipline"));
  assert.ok(ids.includes("intraday_market_feedback"));
});

test("exports concept review pack and applies accepted concepts to profile", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ajm-concepts-"));
  const profilePath = path.join(tmp, "author-judgment-profile.json");
  const reviewDir = path.join(tmp, "review");
  const profile = {
    profile_id: "weibo-123456",
    platform: "weibo",
    author_id: "123456",
    concepts: [],
    update_history: []
  };
  const candidates = [
    {
      id: "housing_kill_line",
      name: "房地产斩杀线",
      aliases: ["斩杀线", "房地产斩杀线"],
      domains: ["real_estate"],
      trigger_conditions: ["问题询问斩杀线或房产税约束"],
      required_variables: ["exit_cost", "liquidity"],
      boundary_conditions: ["需要实时市场数据验证"],
      counterexamples: ["不适用于纯装修问题"],
      time_scope: "2025-12 corpus",
      evidence_unit_ids: ["unit_000001", "unit_000002", "unit_000003"],
      quality: { status: "pass", support_count: 3, failures: [] }
    }
  ];
  fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2));

  const exported = exportConceptReviewPack({ candidates, outDir: reviewDir });
  assert.ok(fs.existsSync(exported.candidatesPath));
  assert.ok(fs.existsSync(exported.reviewTemplatePath));
  assert.ok(fs.existsSync(exported.reviewMarkdownPath));

  const applied = applyConceptReviewToProfileFromFiles({
    reviewPath: exported.reviewTemplatePath,
    profilePath,
    reviewId: "concept_review_test"
  });
  const updated = JSON.parse(fs.readFileSync(profilePath, "utf8"));

  assert.equal(applied.accepted, 1);
  assert.equal(updated.concepts[0].id, "housing_kill_line");
  assert.equal(updated.update_history.at(-1).event, "concepts_applied");
});
