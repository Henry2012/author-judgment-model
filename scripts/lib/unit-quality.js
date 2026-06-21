const fs = require("fs");
const path = require("path");
const { buildArtifactsFromUnits } = require("./pipeline");
const { evaluateQualityGateFromFiles } = require("./quality-gate");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function isWeakUnit(unit) {
  return unit.confidence === "low" || unit.evidence_strength === "weak";
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function summarizeWeakUnits(units) {
  const weakUnits = units.filter(isWeakUnit);
  const byDomain = {};
  for (const unit of weakUnits) {
    const domain = unit.domain || "unknown";
    byDomain[domain] = byDomain[domain] || {
      domain,
      weak_units: 0,
      samples: []
    };
    byDomain[domain].weak_units += 1;
    if (byDomain[domain].samples.length < 5) {
      byDomain[domain].samples.push({
        unit_id: unit.unit_id,
        source_post_id: unit.source_post_id,
        confidence: unit.confidence,
        evidence_strength: unit.evidence_strength,
        claim: unit.claim,
        evidence_excerpt: unit.evidence_excerpt
      });
    }
  }
  return {
    weak_units: weakUnits.length,
    low_confidence_unit_ratio: ratio(weakUnits.length, units.length),
    by_domain: Object.values(byDomain).sort((a, b) => b.weak_units - a.weak_units || a.domain.localeCompare(b.domain))
  };
}

function pruneWeakUnits(units) {
  const kept = [];
  const removed = [];
  for (const unit of units) {
    if (isWeakUnit(unit)) {
      removed.push(unit);
    } else {
      kept.push(unit);
    }
  }
  return { kept, removed };
}

function mergeProfileMetadata(rebuiltProfile, sourceProfile, event) {
  if (!sourceProfile) return rebuiltProfile;
  return {
    ...rebuiltProfile,
    validation_results: Array.isArray(sourceProfile.validation_results) ? sourceProfile.validation_results : rebuiltProfile.validation_results,
    review_results: Array.isArray(sourceProfile.review_results) ? sourceProfile.review_results : rebuiltProfile.review_results,
    update_history: [
      ...(Array.isArray(sourceProfile.update_history) ? sourceProfile.update_history : []),
      event
    ]
  };
}

function pruneWeakUnitsFromFiles(options) {
  const outDir = path.resolve(options.outDir);
  const units = readJson(options.unitsPath);
  const sourceProfile = options.profilePath ? readJson(options.profilePath) : null;
  const before = summarizeWeakUnits(units);
  const pruned = pruneWeakUnits(units);
  const after = summarizeWeakUnits(pruned.kept);
  const prunedUnitsPath = path.join(outDir, "pruned-judgment-units.json");
  const weakUnitReportPath = path.join(outDir, "weak-unit-report.json");
  const qualityGatePath = path.join(outDir, "quality-gate.json");
  const dataDir = path.join(outDir, "data");

  writeJson(prunedUnitsPath, pruned.kept);

  const artifacts = buildArtifactsFromUnits({
    postsPath: options.postsPath,
    unitsPath: prunedUnitsPath,
    authorId: options.authorId,
    authorHandle: options.authorHandle,
    outDir: dataDir,
    configPath: options.configPath
  });

  const rebuiltProfile = readJson(artifacts.profilePath);
  const updatedProfile = mergeProfileMetadata(rebuiltProfile, sourceProfile, {
    updated_at: new Date().toISOString(),
    event: "weak_units_pruned",
    removed_units: pruned.removed.length,
    output_units: pruned.kept.length
  });
  writeJson(artifacts.profilePath, updatedProfile);

  const qualityGate = evaluateQualityGateFromFiles({
    postsPath: options.postsPath,
    unitsPath: prunedUnitsPath,
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
    input_units: units.length,
    output_units: pruned.kept.length,
    removed_units: pruned.removed.map((unit) => unit.unit_id),
    low_confidence_unit_ratio_before: before.low_confidence_unit_ratio,
    low_confidence_unit_ratio_after: after.low_confidence_unit_ratio,
    weak_units_by_domain: before.by_domain,
    quality_gate: {
      status: qualityGate.status,
      score: qualityGate.score,
      blocking_issues: qualityGate.blocking_issues,
      warnings: qualityGate.warnings
    },
    paths: {
      pruned_units: prunedUnitsPath,
      evidence_maps: artifacts.evidenceMapsPath,
      profile: artifacts.profilePath,
      quality_gate: qualityGatePath
    }
  };
  writeJson(weakUnitReportPath, report);

  return {
    profile_id: artifacts.slug,
    prunedUnitsPath,
    weakUnitReportPath,
    evidenceMapsPath: artifacts.evidenceMapsPath,
    profilePath: artifacts.profilePath,
    qualityGatePath,
    removed_units: report.removed_units,
    quality_gate: qualityGate
  };
}

module.exports = {
  isWeakUnit,
  summarizeWeakUnits,
  pruneWeakUnits,
  pruneWeakUnitsFromFiles
};
