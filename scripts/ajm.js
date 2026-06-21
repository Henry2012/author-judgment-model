#!/usr/bin/env node
const path = require("path");
const { runPipeline, buildArtifactsFromUnits } = require("./lib/pipeline");
const { answerFromFiles } = require("./lib/answer");
const { validateArtifactsFromFiles } = require("./lib/validate");
const {
  exportExtractionBatches,
  importExtractionResultsFromFiles,
  runExtractionBatchRequestsFromFiles
} = require("./lib/llm-batch");
const { runValidationCasesFromFiles, applyValidationResultsToProfileFromFiles } = require("./lib/validation-cases");
const { buildReviewReportFromFiles } = require("./lib/report");
const { distillWeibo } = require("./lib/distill");
const { suggestWeiboConfigFromFile } = require("./lib/config-suggest");
const { packageAuthorUnit } = require("./lib/package-author");
const { exportReviewPack } = require("./lib/review-pack");
const { buildWeiboAuthorUnit } = require("./lib/build-author-unit");
const { evaluateQualityGateFromFiles } = require("./lib/quality-gate");
const { applyReviewToProfileFromFiles } = require("./lib/apply-review");
const { applyReviewCorrectionsFromFiles } = require("./lib/apply-review-corrections");
const { generateValidationCasesFromFiles } = require("./lib/validation-case-generator");
const { pruneWeakUnitsFromFiles } = require("./lib/unit-quality");
const {
  discoverConceptCandidatesFromFiles,
  applyConceptReviewToProfileFromFiles
} = require("./lib/concept-discovery");

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      args[key] = argv[i + 1];
      i += 1;
    } else {
      args._.push(token);
    }
  }
  return args;
}

function usage() {
  return [
    "Usage:",
    "  node scripts/ajm.js distill-weibo --raw <raw-index.json> [--author-id <id>] [--author-handle <handle>] [--out data] [--config configs/weibo.default.json] [--llm-results <results.jsonl>] [--unit-prefix llm_unit] [--validation-cases <cases.json>] [--validation-id <id>]",
    "  node scripts/ajm.js build-weibo-author-unit --raw <raw-index.json> --out <author-unit-dir> [--author-id <id>] [--author-handle <handle>] [--config configs/weibo.default.json] [--suggest-config yes] [--llm-results <results.jsonl>] [--validation-cases <cases.json>] [--samples-per-domain 3] [--min-posts 50] [--min-judgment-units 50] [--discover-concepts true] [--concept-discovery-strategy term|trading] [--allow-package-on-fail true]",
    "  node scripts/ajm.js suggest-weibo-config --raw <raw-index.json> [--author-id <id>] [--author-handle <handle>] [--out <config.json>] [--max-domains 6]",
    "  node scripts/ajm.js package-author --profile <author-judgment-profile.json> --units <judgment-units.json> --out <bundle-dir> [--config configs/weibo.default.json]",
    "  node scripts/ajm.js discover-concepts --units <judgment-units.json> --out <concept-review-dir> [--min-evidence-units 3] [--max-candidates 30] [--strategy term|trading]",
    "  node scripts/ajm.js apply-concept-review --review <concept-review-template.json> --profile <author-judgment-profile.json> [--out <profile.json>] [--review-id <id>]",
    "  node scripts/ajm.js review-pack --posts <posts.json> --units <judgment-units.json> --evidence-maps <evidence-maps.json> --profile <author-judgment-profile.json> --out <review-dir> [--samples-per-domain 3]",
    "  node scripts/ajm.js quality-gate --posts <posts.json> --units <judgment-units.json> --evidence-maps <evidence-maps.json> --profile <author-judgment-profile.json> [--out <quality-gate.json>] [--min-posts 50] [--min-judgment-units 50]",
    "  node scripts/ajm.js apply-review --review <manual-review-template.json> --profile <author-judgment-profile.json> [--out <profile.json>] [--review-id <id>]",
    "  node scripts/ajm.js apply-review-corrections --review <manual-review-template.json> --posts <posts.json> --units <judgment-units.json> --out <corrected-dir> [--config configs/weibo.default.json] [--author-id <id>] [--author-handle <handle>] [--review-id <id>]",
    "  node scripts/ajm.js prune-weak-units --posts <posts.json> --units <judgment-units.json> --profile <author-judgment-profile.json> --out <pruned-dir> [--config configs/weibo.default.json] [--author-id <id>] [--author-handle <handle>]",
    "  node scripts/ajm.js build-weibo --raw <raw-index.json> [--author-id <id>] [--author-handle <handle>] [--out data] [--config configs/weibo.default.json]",
    "  node scripts/ajm.js rebuild-profile --posts <posts.json> --units <judgment-units.json> [--author-id <id>] [--author-handle <handle>] [--out data] [--config configs/weibo.default.json]",
    "  node scripts/ajm.js export-llm-batches --posts <posts.json> --out <requests.jsonl> [--batch-size 20] [--config configs/weibo.default.json]",
    "  node scripts/ajm.js run-llm-batches --requests <requests.jsonl> --results <results.jsonl> --model <model> [--base-url <url>] [--api-key-env OPENAI_API_KEY] [--limit n]",
    "  node scripts/ajm.js import-llm-units --posts <posts.json> --results <results.jsonl> --out <judgment-units.json> [--unit-prefix llm_unit]",
    "  node scripts/ajm.js answer --profile <author-judgment-profile.json> --units <judgment-units.json> --question <question> [--config configs/weibo.default.json]",
    "  node scripts/ajm.js run-validation-cases --cases <validation-cases.json> --profile <author-judgment-profile.json> --units <judgment-units.json> [--config configs/weibo.default.json]",
    "  node scripts/ajm.js generate-validation-cases --profile <author-judgment-profile.json> --out <validation-cases.json> [--config configs/weibo.default.json] [--max-domains 6] [--case-prefix author]",
    "  node scripts/ajm.js apply-validation-results --cases <validation-cases.json> --profile <author-judgment-profile.json> --units <judgment-units.json> [--out <profile.json>] [--config configs/weibo.default.json]",
    "  node scripts/ajm.js validate --posts <posts.json> --units <judgment-units.json> --evidence-maps <evidence-maps.json> --profile <author-judgment-profile.json>",
    "  node scripts/ajm.js report --posts <posts.json> --units <judgment-units.json> --evidence-maps <evidence-maps.json> --profile <author-judgment-profile.json>",
    "",
    "Example:",
    "  node scripts/ajm.js build-weibo-author-unit --raw /path/to/raw-index.json --author-id 2611641261 --author-handle sanshu --out dist/weibo-2611641261 --validation-cases data/validation/weibo-2611641261/validation-cases.json",
    "  node scripts/ajm.js distill-weibo --raw /path/to/raw-index.json --author-id 2611641261 --author-handle sanshu --out data --validation-cases data/validation/weibo-2611641261/validation-cases.json",
    "  node scripts/ajm.js suggest-weibo-config --raw /path/to/raw-index.json --out configs/weibo.author.json --max-domains 6",
    "  node scripts/ajm.js package-author --profile data/profiles/weibo-2611641261/author-judgment-profile.json --units data/judgment-units/weibo-2611641261/judgment-units.json --out dist/weibo-2611641261 --config configs/weibo.default.json",
    "  node scripts/ajm.js review-pack --posts data/normalized/weibo-2611641261/posts.json --units data/judgment-units/weibo-2611641261/judgment-units.json --evidence-maps data/evidence-maps/weibo-2611641261/evidence-maps.json --profile data/profiles/weibo-2611641261/author-judgment-profile.json --out reviews/weibo-2611641261",
    "  node scripts/ajm.js quality-gate --posts data/normalized/weibo-2611641261/posts.json --units data/judgment-units/weibo-2611641261/judgment-units.json --evidence-maps data/evidence-maps/weibo-2611641261/evidence-maps.json --profile data/profiles/weibo-2611641261/author-judgment-profile.json",
    "  node scripts/ajm.js apply-review --review reviews/weibo-2611641261/manual-review-template.json --profile data/profiles/weibo-2611641261/author-judgment-profile.json",
    "  node scripts/ajm.js apply-review-corrections --review reviews/weibo-2611641261/manual-review-template.json --posts data/normalized/weibo-2611641261/posts.json --units data/judgment-units/weibo-2611641261/judgment-units.json --out corrections/weibo-2611641261",
    "  node scripts/ajm.js prune-weak-units --posts data/normalized/weibo-2611641261/posts.json --units data/judgment-units/weibo-2611641261/judgment-units.json --profile data/profiles/weibo-2611641261/author-judgment-profile.json --out pruned/weibo-2611641261",
    "  node scripts/ajm.js build-weibo --raw /path/to/raw-index.json --author-id 2611641261 --author-handle sanshu --out data",
    "  node scripts/ajm.js rebuild-profile --posts data/normalized/weibo-2611641261/posts.json --units data/judgment-units/weibo-2611641261/llm-judgment-units.json --author-id 2611641261 --author-handle sanshu --out data",
    "  node scripts/ajm.js export-llm-batches --posts data/normalized/weibo-2611641261/posts.json --out data/llm-batches/weibo-2611641261/requests.jsonl",
    "  node scripts/ajm.js run-llm-batches --requests data/llm-batches/weibo-2611641261/requests.jsonl --results data/llm-batches/weibo-2611641261/results.jsonl --model gpt-5.5",
    "  node scripts/ajm.js import-llm-units --posts data/normalized/weibo-2611641261/posts.json --results data/llm-batches/weibo-2611641261/results.jsonl --out data/judgment-units/weibo-2611641261/llm-judgment-units.json",
    "  node scripts/ajm.js answer --profile data/profiles/weibo-2611641261/author-judgment-profile.json --units data/judgment-units/weibo-2611641261/judgment-units.json --question \"现在还适合买房吗\"",
    "  node scripts/ajm.js run-validation-cases --cases data/validation/weibo-2611641261/validation-cases.json --profile data/profiles/weibo-2611641261/author-judgment-profile.json --units data/judgment-units/weibo-2611641261/judgment-units.json",
    "  node scripts/ajm.js generate-validation-cases --profile data/profiles/weibo-2611641261/author-judgment-profile.json --out data/validation/weibo-2611641261/validation-cases.generated.json",
    "  node scripts/ajm.js apply-validation-results --cases data/validation/weibo-2611641261/validation-cases.json --profile data/profiles/weibo-2611641261/author-judgment-profile.json --units data/judgment-units/weibo-2611641261/judgment-units.json",
    "  node scripts/ajm.js validate --posts data/normalized/weibo-2611641261/posts.json --units data/judgment-units/weibo-2611641261/judgment-units.json --evidence-maps data/evidence-maps/weibo-2611641261/evidence-maps.json --profile data/profiles/weibo-2611641261/author-judgment-profile.json",
    "  node scripts/ajm.js report --posts data/normalized/weibo-2611641261/posts.json --units data/judgment-units/weibo-2611641261/judgment-units.json --evidence-maps data/evidence-maps/weibo-2611641261/evidence-maps.json --profile data/profiles/weibo-2611641261/author-judgment-profile.json"
  ].join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];

  if (command === "distill-weibo") {
    if (!args.raw) {
      console.error(usage());
      process.exit(1);
    }
    const result = distillWeibo({
      rawPath: path.resolve(args.raw),
      authorId: args.authorId,
      authorHandle: args.authorHandle,
      outDir: path.resolve(args.out || "data"),
      configPath: path.resolve(args.config || "configs/weibo.default.json"),
      llmResultsPath: args.llmResults ? path.resolve(args.llmResults) : undefined,
      unitPrefix: args.unitPrefix,
      validationCasesPath: args.validationCases ? path.resolve(args.validationCases) : undefined,
      validationId: args.validationId
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "build-weibo-author-unit") {
    if (!args.raw || !args.out) {
      console.error(usage());
      process.exit(1);
    }
    const result = buildWeiboAuthorUnit({
      rawPath: path.resolve(args.raw),
      authorId: args.authorId,
      authorHandle: args.authorHandle,
      outDir: path.resolve(args.out),
      configPath: args.config ? path.resolve(args.config) : undefined,
      suggestConfig: args.suggestConfig === "yes" || args.suggestConfig === "true",
      maxDomains: args.maxDomains,
      llmResultsPath: args.llmResults ? path.resolve(args.llmResults) : undefined,
      unitPrefix: args.unitPrefix,
      validationCasesPath: args.validationCases ? path.resolve(args.validationCases) : undefined,
      validationId: args.validationId,
      samplesPerDomain: args.samplesPerDomain,
      minPosts: args.minPosts,
      minJudgmentUnits: args.minJudgmentUnits,
      minMentalModels: args.minMentalModels,
      warnGeneralUnitRatio: args.warnGeneralUnitRatio,
      failGeneralUnitRatio: args.failGeneralUnitRatio,
      warnLowConfidenceUnitRatio: args.warnLowConfidenceUnitRatio,
      discoverConcepts: args.discoverConcepts === "yes" || args.discoverConcepts === "true",
      minConceptEvidenceUnits: args.minConceptEvidenceUnits,
      maxConceptCandidates: args.maxConceptCandidates,
      conceptDiscoveryStrategy: args.conceptDiscoveryStrategy,
      conceptReviewId: args.conceptReviewId,
      allowPackageOnFail: args.allowPackageOnFail
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "suggest-weibo-config") {
    if (!args.raw) {
      console.error(usage());
      process.exit(1);
    }
    const result = suggestWeiboConfigFromFile({
      rawPath: path.resolve(args.raw),
      authorId: args.authorId,
      authorHandle: args.authorHandle,
      outPath: args.out ? path.resolve(args.out) : undefined,
      maxDomains: args.maxDomains
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "package-author") {
    if (!args.profile || !args.units || !args.out) {
      console.error(usage());
      process.exit(1);
    }
    const result = packageAuthorUnit({
      profilePath: path.resolve(args.profile),
      unitsPath: path.resolve(args.units),
      configPath: args.config ? path.resolve(args.config) : undefined,
      outDir: path.resolve(args.out)
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "discover-concepts") {
    if (!args.units || !args.out) {
      console.error(usage());
      process.exit(1);
    }
    const result = discoverConceptCandidatesFromFiles({
      unitsPath: path.resolve(args.units),
      outDir: path.resolve(args.out),
      minEvidenceUnits: args.minEvidenceUnits,
      maxCandidates: args.maxCandidates,
      strategy: args.strategy
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "apply-concept-review") {
    if (!args.review || !args.profile) {
      console.error(usage());
      process.exit(1);
    }
    const result = applyConceptReviewToProfileFromFiles({
      reviewPath: path.resolve(args.review),
      profilePath: path.resolve(args.profile),
      outPath: args.out ? path.resolve(args.out) : undefined,
      reviewId: args.reviewId
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "review-pack") {
    if (!args.posts || !args.units || !args.evidenceMaps || !args.profile || !args.out) {
      console.error(usage());
      process.exit(1);
    }
    const result = exportReviewPack({
      postsPath: path.resolve(args.posts),
      unitsPath: path.resolve(args.units),
      evidenceMapsPath: path.resolve(args.evidenceMaps),
      profilePath: path.resolve(args.profile),
      outDir: path.resolve(args.out),
      samplesPerDomain: args.samplesPerDomain
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "quality-gate") {
    if (!args.posts || !args.units || !args.evidenceMaps || !args.profile) {
      console.error(usage());
      process.exit(1);
    }
    const result = evaluateQualityGateFromFiles({
      postsPath: path.resolve(args.posts),
      unitsPath: path.resolve(args.units),
      evidenceMapsPath: path.resolve(args.evidenceMaps),
      profilePath: path.resolve(args.profile),
      outPath: args.out ? path.resolve(args.out) : undefined,
      minPosts: args.minPosts,
      minJudgmentUnits: args.minJudgmentUnits,
      minMentalModels: args.minMentalModels,
      warnGeneralUnitRatio: args.warnGeneralUnitRatio,
      failGeneralUnitRatio: args.failGeneralUnitRatio
    });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.status === "fail" ? 2 : 0);
  }

  if (command === "apply-review") {
    if (!args.review || !args.profile) {
      console.error(usage());
      process.exit(1);
    }
    const result = applyReviewToProfileFromFiles({
      reviewPath: path.resolve(args.review),
      profilePath: path.resolve(args.profile),
      outPath: args.out ? path.resolve(args.out) : undefined,
      reviewId: args.reviewId
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "apply-review-corrections") {
    if (!args.review || !args.posts || !args.units || !args.out) {
      console.error(usage());
      process.exit(1);
    }
    const result = applyReviewCorrectionsFromFiles({
      reviewPath: path.resolve(args.review),
      postsPath: path.resolve(args.posts),
      unitsPath: path.resolve(args.units),
      outDir: path.resolve(args.out),
      configPath: path.resolve(args.config || "configs/weibo.default.json"),
      authorId: args.authorId,
      authorHandle: args.authorHandle,
      reviewId: args.reviewId,
      minPosts: args.minPosts,
      minJudgmentUnits: args.minJudgmentUnits,
      minMentalModels: args.minMentalModels,
      warnGeneralUnitRatio: args.warnGeneralUnitRatio,
      failGeneralUnitRatio: args.failGeneralUnitRatio,
      warnLowConfidenceUnitRatio: args.warnLowConfidenceUnitRatio
    });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.quality_gate.status === "fail" ? 2 : 0);
  }

  if (command === "prune-weak-units") {
    if (!args.posts || !args.units || !args.profile || !args.out) {
      console.error(usage());
      process.exit(1);
    }
    const result = pruneWeakUnitsFromFiles({
      postsPath: path.resolve(args.posts),
      unitsPath: path.resolve(args.units),
      profilePath: path.resolve(args.profile),
      outDir: path.resolve(args.out),
      configPath: path.resolve(args.config || "configs/weibo.default.json"),
      authorId: args.authorId,
      authorHandle: args.authorHandle,
      minPosts: args.minPosts,
      minJudgmentUnits: args.minJudgmentUnits,
      minMentalModels: args.minMentalModels,
      warnGeneralUnitRatio: args.warnGeneralUnitRatio,
      failGeneralUnitRatio: args.failGeneralUnitRatio,
      warnLowConfidenceUnitRatio: args.warnLowConfidenceUnitRatio
    });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.quality_gate.status === "fail" ? 2 : 0);
  }

  if (command === "answer") {
    if (!args.profile || !args.units || !args.question) {
      console.error(usage());
      process.exit(1);
    }
    const answer = answerFromFiles({
      profilePath: path.resolve(args.profile),
      unitsPath: path.resolve(args.units),
      question: args.question,
      configPath: path.resolve(args.config || "configs/weibo.default.json")
    });
    console.log(JSON.stringify(answer, null, 2));
    return;
  }

  if (command === "rebuild-profile") {
    if (!args.posts || !args.units) {
      console.error(usage());
      process.exit(1);
    }
    const result = buildArtifactsFromUnits({
      postsPath: path.resolve(args.posts),
      unitsPath: path.resolve(args.units),
      authorId: args.authorId,
      authorHandle: args.authorHandle,
      outDir: path.resolve(args.out || "data"),
      configPath: path.resolve(args.config || "configs/weibo.default.json")
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "export-llm-batches") {
    if (!args.posts || !args.out) {
      console.error(usage());
      process.exit(1);
    }
    const result = exportExtractionBatches({
      postsPath: path.resolve(args.posts),
      outPath: path.resolve(args.out),
      configPath: path.resolve(args.config || "configs/weibo.default.json"),
      batchSize: args.batchSize,
      batchPrefix: args.batchPrefix
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "import-llm-units") {
    if (!args.posts || !args.results || !args.out) {
      console.error(usage());
      process.exit(1);
    }
    const result = importExtractionResultsFromFiles({
      postsPath: path.resolve(args.posts),
      resultsPath: path.resolve(args.results),
      outPath: path.resolve(args.out),
      unitPrefix: args.unitPrefix || "llm_unit"
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "run-llm-batches") {
    if (!args.requests || !args.results || !args.model) {
      console.error(usage());
      process.exit(1);
    }
    runExtractionBatchRequestsFromFiles({
      requestsPath: path.resolve(args.requests),
      resultsPath: path.resolve(args.results),
      model: args.model,
      baseUrl: args.baseUrl,
      apiKeyEnv: args.apiKeyEnv || "OPENAI_API_KEY",
      limit: args.limit,
      temperature: args.temperature
    })
      .then((result) => {
        console.log(JSON.stringify(result, null, 2));
      })
      .catch((error) => {
        console.error(error.message);
        process.exit(1);
      });
    return;
  }

  if (command === "run-validation-cases") {
    if (!args.cases || !args.profile || !args.units) {
      console.error(usage());
      process.exit(1);
    }
    const report = runValidationCasesFromFiles({
      casesPath: path.resolve(args.cases),
      profilePath: path.resolve(args.profile),
      unitsPath: path.resolve(args.units),
      configPath: path.resolve(args.config || "configs/weibo.default.json")
    });
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.status === "pass" ? 0 : 2);
  }

  if (command === "generate-validation-cases") {
    if (!args.profile || !args.out) {
      console.error(usage());
      process.exit(1);
    }
    const result = generateValidationCasesFromFiles({
      profilePath: path.resolve(args.profile),
      configPath: path.resolve(args.config || "configs/weibo.default.json"),
      outPath: path.resolve(args.out),
      maxDomains: args.maxDomains,
      casePrefix: args.casePrefix,
      unsupportedQuestion: args.unsupportedQuestion
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "apply-validation-results") {
    if (!args.cases || !args.profile || !args.units) {
      console.error(usage());
      process.exit(1);
    }
    const result = applyValidationResultsToProfileFromFiles({
      casesPath: path.resolve(args.cases),
      profilePath: path.resolve(args.profile),
      unitsPath: path.resolve(args.units),
      outPath: args.out ? path.resolve(args.out) : undefined,
      configPath: path.resolve(args.config || "configs/weibo.default.json"),
      validationId: args.validationId
    });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.status === "pass" ? 0 : 2);
  }

  if (command === "validate") {
    if (!args.posts || !args.units || !args.evidenceMaps || !args.profile) {
      console.error(usage());
      process.exit(1);
    }
    const report = validateArtifactsFromFiles({
      postsPath: path.resolve(args.posts),
      unitsPath: path.resolve(args.units),
      evidenceMapsPath: path.resolve(args.evidenceMaps),
      profilePath: path.resolve(args.profile)
    });
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.status === "pass" ? 0 : 2);
  }

  if (command === "report") {
    if (!args.posts || !args.units || !args.evidenceMaps || !args.profile) {
      console.error(usage());
      process.exit(1);
    }
    const report = buildReviewReportFromFiles({
      postsPath: path.resolve(args.posts),
      unitsPath: path.resolve(args.units),
      evidenceMapsPath: path.resolve(args.evidenceMaps),
      profilePath: path.resolve(args.profile)
    });
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (command !== "build-weibo" || !args.raw) {
    console.error(usage());
    process.exit(command === "help" ? 0 : 1);
  }

  const result = runPipeline({
    rawPath: path.resolve(args.raw),
    authorId: args.authorId,
    authorHandle: args.authorHandle,
    outDir: path.resolve(args.out || "data"),
    configPath: path.resolve(args.config || "configs/weibo.default.json")
  });

  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main();
}
