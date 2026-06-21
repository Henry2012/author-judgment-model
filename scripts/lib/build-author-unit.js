const fs = require("fs");
const path = require("path");
const { distillWeibo } = require("./distill");
const { exportReviewPack } = require("./review-pack");
const { packageAuthorUnit } = require("./package-author");
const { suggestWeiboConfigFromFile } = require("./config-suggest");
const { evaluateQualityGateFromFiles } = require("./quality-gate");
const { discoverConceptCandidatesFromFiles, applyConceptReviewToProfileFromFiles } = require("./concept-discovery");

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function shouldPackageOnFailedGate(options) {
  return options.allowPackageOnFail === true || options.allowPackageOnFail === "true" || options.allowPackageOnFail === "yes";
}

function buildWeiboAuthorUnit(options) {
  const outDir = path.resolve(options.outDir || "author-unit");
  const dataDir = path.join(outDir, "data");
  const reviewDir = path.join(outDir, "review");
  const packageDir = path.join(outDir, "package");
  const generatedConfigPath = path.join(outDir, "configs", "weibo.suggested.json");
  const configPath = options.suggestConfig
    ? suggestWeiboConfigFromFile({
        rawPath: path.resolve(options.rawPath),
        authorId: options.authorId,
        authorHandle: options.authorHandle,
        outPath: generatedConfigPath,
        maxDomains: options.maxDomains
      }).outPath
    : path.resolve(options.configPath || "configs/weibo.default.json");

  const distill = distillWeibo({
    rawPath: path.resolve(options.rawPath),
    authorId: options.authorId,
    authorHandle: options.authorHandle,
    outDir: dataDir,
    configPath,
    llmResultsPath: options.llmResultsPath,
    unitPrefix: options.unitPrefix,
    validationCasesPath: options.validationCasesPath,
    validationId: options.validationId
  });
  const conceptDiscovery = options.discoverConcepts
    ? discoverConceptCandidatesFromFiles({
        unitsPath: distill.unitsPath,
        outDir: path.join(reviewDir, "concepts"),
        minEvidenceUnits: options.minConceptEvidenceUnits,
        maxCandidates: options.maxConceptCandidates
      })
    : null;
  const conceptApply = conceptDiscovery
    ? applyConceptReviewToProfileFromFiles({
        reviewPath: conceptDiscovery.paths.reviewTemplatePath,
        profilePath: distill.profilePath,
        reviewId: options.conceptReviewId || `${distill.slug}_concept_discovery_001`
      })
    : null;
  const review = exportReviewPack({
    postsPath: distill.postsPath,
    unitsPath: distill.unitsPath,
    evidenceMapsPath: distill.evidenceMapsPath,
    profilePath: distill.profilePath,
    outDir: reviewDir,
    samplesPerDomain: options.samplesPerDomain
  });
  const qualityGate = evaluateQualityGateFromFiles({
    postsPath: distill.postsPath,
    unitsPath: distill.unitsPath,
    evidenceMapsPath: distill.evidenceMapsPath,
    profilePath: distill.profilePath,
    outPath: path.join(reviewDir, "quality-gate.json"),
    minPosts: options.minPosts,
    minJudgmentUnits: options.minJudgmentUnits,
    minMentalModels: options.minMentalModels,
    warnGeneralUnitRatio: options.warnGeneralUnitRatio,
    failGeneralUnitRatio: options.failGeneralUnitRatio,
    warnLowConfidenceUnitRatio: options.warnLowConfidenceUnitRatio
  });
  const packageBlocked = qualityGate.status === "fail" && !shouldPackageOnFailedGate(options);
  const packaged = packageBlocked
    ? null
    : packageAuthorUnit({
        profilePath: distill.profilePath,
        unitsPath: distill.unitsPath,
        configPath,
        outDir: packageDir
      });
  const manifest = {
    package_type: "weibo_author_judgment_unit_build",
    version: "0.1.0",
    profile_id: distill.slug,
    stages: [
      "distill",
      ...(conceptDiscovery ? ["concept-discovery", "apply-concept-review"] : []),
      "review-pack",
      "quality-gate",
      ...(packageBlocked ? [] : ["package-author"])
    ],
    config: {
      path: configPath,
      generated: Boolean(options.suggestConfig),
      concept_discovery_enabled: Boolean(conceptDiscovery)
    },
    artifacts: {
      data: dataDir,
      review: reviewDir,
      package: packageBlocked ? null : packageDir,
      profile: distill.profilePath,
      units: distill.unitsPath,
      evidence_maps: distill.evidenceMapsPath,
      posts: distill.postsPath
    },
    distill: {
      posts: distill.posts,
      units: distill.units,
      evidence_maps: distill.evidenceMaps,
      validation: distill.report.validation,
      risks: distill.report.risks
    },
    review: {
      validation_status: review.validation_status,
      risks: review.risks,
      sample_units: review.sample_units.length
    },
    concept_discovery: conceptDiscovery
      ? {
          candidates: conceptDiscovery.candidates.length,
          pass: conceptDiscovery.quality_gate.pass,
          fail: conceptDiscovery.quality_gate.fail,
          accepted: conceptApply.accepted,
          review_template: conceptDiscovery.paths.reviewTemplatePath,
          review_markdown: conceptDiscovery.paths.reviewMarkdownPath
        }
      : null,
    quality_gate: {
      status: qualityGate.status,
      score: qualityGate.score,
      blocking_issues: qualityGate.blocking_issues,
      warnings: qualityGate.warnings,
      recommendations: qualityGate.recommendations
    },
    package: {
      blocked: packageBlocked,
      reason: packageBlocked ? "quality_gate_failed" : "",
      entrypoints: packaged ? packaged.entrypoints : [],
      data_files: packaged ? packaged.data_files : []
    }
  };
  const manifestPath = path.join(outDir, "build-manifest.json");
  writeJson(manifestPath, manifest);

  if (packageBlocked) {
    const error = new Error(`Quality gate failed; package generation blocked for ${distill.slug}.`);
    error.code = "QUALITY_GATE_FAILED";
    error.manifestPath = manifestPath;
    error.qualityGate = qualityGate;
    throw error;
  }

  return {
    outDir,
    profile_id: distill.slug,
    manifestPath,
    paths: {
      dataDir,
      reviewDir,
      packageDir,
      configPath
    },
    distill,
    review,
    qualityGate,
    package: packaged
  };
}

module.exports = {
  buildWeiboAuthorUnit
};
