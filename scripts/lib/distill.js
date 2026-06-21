const path = require("path");
const { runPipeline, buildArtifactsFromUnits } = require("./pipeline");
const { importExtractionResultsFromFiles } = require("./llm-batch");
const { applyValidationResultsToProfileFromFiles } = require("./validation-cases");
const { buildReviewReportFromFiles } = require("./report");

function artifactPaths(outDir, slug) {
  return {
    postsPath: path.join(outDir, "normalized", slug, "posts.json"),
    unitsPath: path.join(outDir, "judgment-units", slug, "judgment-units.json"),
    evidenceMapsPath: path.join(outDir, "evidence-maps", slug, "evidence-maps.json"),
    profilePath: path.join(outDir, "profiles", slug, "author-judgment-profile.json")
  };
}

function distillWeibo(options) {
  const outDir = path.resolve(options.outDir || "data");
  const configPath = path.resolve(options.configPath || "configs/weibo.default.json");
  const build = runPipeline({
    rawPath: path.resolve(options.rawPath),
    authorId: options.authorId,
    authorHandle: options.authorHandle,
    outDir,
    configPath
  });
  const paths = artifactPaths(outDir, build.slug);
  const llmImported = options.llmResultsPath
    ? importExtractionResultsFromFiles({
        postsPath: paths.postsPath,
        resultsPath: path.resolve(options.llmResultsPath),
        outPath: paths.unitsPath,
        unitPrefix: options.unitPrefix || "llm_unit"
      })
    : null;
  const rebuilt = llmImported
    ? buildArtifactsFromUnits({
        postsPath: paths.postsPath,
        unitsPath: paths.unitsPath,
        authorId: options.authorId,
        authorHandle: options.authorHandle,
        outDir,
        configPath
      })
    : null;
  const validationApplied = options.validationCasesPath
    ? applyValidationResultsToProfileFromFiles({
        casesPath: path.resolve(options.validationCasesPath),
        profilePath: paths.profilePath,
        unitsPath: paths.unitsPath,
        configPath,
        validationId: options.validationId
      })
    : null;
  const report = buildReviewReportFromFiles(paths);

  return {
    ...build,
    units: rebuilt ? rebuilt.units : build.units,
    evidenceMaps: rebuilt ? rebuilt.evidenceMaps : build.evidenceMaps,
    ...paths,
    llmImported,
    validationApplied,
    report: {
      validation: report.validation,
      risks: report.risks,
      counts: report.counts
    }
  };
}

module.exports = {
  artifactPaths,
  distillWeibo
};
