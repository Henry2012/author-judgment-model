const fs = require("fs");
const path = require("path");
const { buildArtifactsFromUnits } = require("./pipeline");
const { applyReviewToProfile } = require("./apply-review");
const { evaluateQualityGateFromFiles } = require("./quality-gate");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function normalizeAction(action, status) {
  const value = String(action || status || "").trim().toLowerCase();
  if (["reject", "rejected", "delete", "remove"].includes(value)) return "reject";
  if (["revise", "needs_revision", "needs-revision", "revision"].includes(value)) return "needs_revision";
  if (["approve", "approved"].includes(value)) return "approved";
  return "";
}

function collectReviewActions(review) {
  const rejected = new Map();
  const revisions = new Map();

  for (const domainReview of review.domain_reviews || []) {
    const action = normalizeAction(undefined, domainReview.status);
    const note = domainReview.notes || "";
    for (const unitId of domainReview.sampled_unit_ids || []) {
      if (action === "reject") {
        rejected.set(unitId, {
          source: "domain_review",
          domain: domainReview.domain,
          note
        });
      } else if (action === "needs_revision") {
        revisions.set(unitId, {
          source: "domain_review",
          domain: domainReview.domain,
          note
        });
      }
    }
  }

  for (const issue of review.issue_log || []) {
    if (issue.item_type !== "unit" || !issue.item_id) continue;
    const action = normalizeAction(issue.action, issue.status);
    const note = issue.note || issue.notes || "";
    if (action === "reject") {
      rejected.set(issue.item_id, {
        source: "issue_log",
        severity: issue.severity || "",
        note
      });
      revisions.delete(issue.item_id);
    } else if (action === "needs_revision") {
      revisions.set(issue.item_id, {
        source: "issue_log",
        severity: issue.severity || "",
        note
      });
    }
  }

  for (const unitId of rejected.keys()) revisions.delete(unitId);
  return { rejected, revisions };
}

function applyCorrectionsToUnits(units, review) {
  const { rejected, revisions } = collectReviewActions(review);
  const removedUnits = [];
  const annotatedUnits = [];
  const correctedUnits = [];

  for (const unit of units) {
    if (rejected.has(unit.unit_id)) {
      removedUnits.push({
        unit_id: unit.unit_id,
        ...rejected.get(unit.unit_id)
      });
      continue;
    }

    if (revisions.has(unit.unit_id)) {
      const revision = revisions.get(unit.unit_id);
      annotatedUnits.push({
        unit_id: unit.unit_id,
        ...revision
      });
      correctedUnits.push({
        ...unit,
        review_status: "needs_revision",
        review_notes: revision.note || unit.review_notes || "",
        review_source: revision.source
      });
      continue;
    }

    correctedUnits.push(unit);
  }

  return {
    units: correctedUnits,
    removed_units: removedUnits,
    annotated_units: annotatedUnits
  };
}

function applyReviewCorrectionsFromFiles(options) {
  const outDir = path.resolve(options.outDir);
  const review = readJson(options.reviewPath);
  const units = readJson(options.unitsPath);
  const corrected = applyCorrectionsToUnits(units, review);
  const correctedUnitsPath = path.join(outDir, "corrected-judgment-units.json");
  const dataDir = path.join(outDir, "data");
  const qualityGatePath = path.join(outDir, "quality-gate.json");
  const correctionReportPath = path.join(outDir, "correction-report.json");

  writeJson(correctedUnitsPath, corrected.units);

  const artifacts = buildArtifactsFromUnits({
    postsPath: options.postsPath,
    unitsPath: correctedUnitsPath,
    authorId: options.authorId,
    authorHandle: options.authorHandle,
    outDir: dataDir,
    configPath: options.configPath
  });

  const rebuiltProfile = readJson(artifacts.profilePath);
  const reviewedProfile = applyReviewToProfile(rebuiltProfile, review, {
    reviewId: options.reviewId
  });
  writeJson(artifacts.profilePath, reviewedProfile);

  const qualityGate = evaluateQualityGateFromFiles({
    postsPath: options.postsPath,
    unitsPath: correctedUnitsPath,
    evidenceMapsPath: artifacts.evidenceMapsPath,
    profilePath: artifacts.profilePath,
    outPath: qualityGatePath,
    minPosts: options.minPosts,
    minJudgmentUnits: options.minJudgmentUnits,
    minMentalModels: options.minMentalModels,
    warnGeneralUnitRatio: options.warnGeneralUnitRatio,
    failGeneralUnitRatio: options.failGeneralUnitRatio,
    warnLowConfidenceUnitRatio: options.warnLowConfidenceUnitRatio
  });

  const report = {
    profile_id: artifacts.slug,
    review_id: options.reviewId || reviewedProfile.review_results.at(-1)?.review_id || "",
    input_units: units.length,
    output_units: corrected.units.length,
    removed_units: corrected.removed_units,
    annotated_units: corrected.annotated_units,
    quality_gate: {
      status: qualityGate.status,
      score: qualityGate.score,
      blocking_issues: qualityGate.blocking_issues,
      warnings: qualityGate.warnings
    },
    paths: {
      corrected_units: correctedUnitsPath,
      evidence_maps: artifacts.evidenceMapsPath,
      profile: artifacts.profilePath,
      quality_gate: qualityGatePath
    }
  };
  writeJson(correctionReportPath, report);

  return {
    profile_id: artifacts.slug,
    correctedUnitsPath,
    evidenceMapsPath: artifacts.evidenceMapsPath,
    profilePath: artifacts.profilePath,
    qualityGatePath,
    correctionReportPath,
    removed_units: corrected.removed_units.map((item) => item.unit_id),
    annotated_units: corrected.annotated_units.map((item) => item.unit_id),
    quality_gate: qualityGate
  };
}

module.exports = {
  applyCorrectionsToUnits,
  applyReviewCorrectionsFromFiles,
  collectReviewActions
};
