const fs = require("fs");
const path = require("path");
const { buildReviewReportFromFiles } = require("./report");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${String(value).replace(/\s+$/u, "")}\n`);
}

function writeJson(filePath, value) {
  writeFile(filePath, JSON.stringify(value, null, 2));
}

function selectSampleUnits(report, limitPerDomain) {
  const samples = [];
  for (const domain of report.domains || []) {
    for (const unit of (domain.top_evidence_units || []).slice(0, limitPerDomain)) {
      samples.push({
        domain: domain.domain,
        confidence: domain.confidence,
        unit_id: unit.unit_id,
        source_post_id: unit.source_post_id,
        created_at: unit.created_at,
        claim: unit.claim,
        evidence_excerpt: unit.evidence_excerpt,
        source_url: unit.source_url,
        review_questions: [
          "Does the evidence excerpt exactly support the claim?",
          "Are the variables and domain labels specific enough?",
          "Does this unit avoid persona or tone imitation?"
        ]
      });
    }
  }
  return samples;
}

function buildSampleMarkdown(report, samples) {
  const lines = [
    `# Review Samples: ${report.profile_id}`,
    "",
    "Use these sampled evidence units for human spot checks. Mark issues in `manual-review-template.json`.",
    ""
  ];
  for (const sample of samples) {
    lines.push(`## ${sample.domain} / ${sample.unit_id}`);
    lines.push("");
    lines.push(`- Source post: ${sample.source_post_id}`);
    lines.push(`- Created at: ${sample.created_at || "unknown"}`);
    lines.push(`- Confidence: ${sample.confidence}`);
    lines.push(`- Source URL: ${sample.source_url || ""}`);
    lines.push("");
    lines.push(`Claim: ${sample.claim}`);
    lines.push("");
    lines.push(`Evidence excerpt: ${sample.evidence_excerpt}`);
    lines.push("");
  }
  return lines.join("\n");
}

function buildChecklist(report) {
  return [
    `# Manual Review Checklist: ${report.profile_id}`,
    "",
    "## Pass Criteria",
    "",
    "- Artifact validation status is `pass`.",
    "- High-impact domains have sampled evidence reviewed.",
    "- Evidence excerpts directly support their claims.",
    "- Domain labels and variables are specific to the author's corpus.",
    "- Mental models are judgment logic, not personality or writing style.",
    "- Unsupported Topic Boundary is explicit: low evidence topics are refused or downgraded.",
    "- Known-stance validation cases are run and persisted before serious use.",
    "",
    "## Evidence Grounding",
    "",
    "- Check each sampled unit against its source post.",
    "- Flag any evidence excerpt that is absent, paraphrased as fact, or too broad.",
    "- Flag claims that infer motives, identity, or future personal views.",
    "",
    "## Risk Review",
    "",
    report.risks.length ? report.risks.map((risk) => `- ${risk}`).join("\n") : "- No machine-detected risks.",
    "",
    "## Unsupported Topic Boundary",
    "",
    "The answer engine must refuse or downgrade confidence when no matching evidence-backed model exists."
  ].join("\n");
}

function buildManualReviewTemplate(report, samples) {
  return {
    profile_id: report.profile_id,
    status: "pending",
    reviewer: "",
    reviewed_at: "",
    overall_notes: "",
    pass_criteria: {
      artifact_validation_passed: report.validation.status === "pass",
      evidence_samples_reviewed: false,
      known_stance_cases_persisted: !report.risks.includes("validation_results_not_embedded_in_profile"),
      unsupported_topic_boundary_checked: false
    },
    domain_reviews: (report.domains || []).map((domain) => ({
      domain: domain.domain,
      status: "pending",
      notes: "",
      sampled_unit_ids: samples.filter((sample) => sample.domain === domain.domain).map((sample) => sample.unit_id)
    })),
    issue_log: []
  };
}

function exportReviewPack(options) {
  const outDir = path.resolve(options.outDir);
  const report = buildReviewReportFromFiles({
    postsPath: options.postsPath,
    unitsPath: options.unitsPath,
    evidenceMapsPath: options.evidenceMapsPath,
    profilePath: options.profilePath
  });
  const profile = readJson(options.profilePath);
  const limitPerDomain = Number(options.samplesPerDomain || 3);
  const sampleUnits = selectSampleUnits(report, limitPerDomain);
  const summary = {
    profile_id: report.profile_id,
    platform: report.platform,
    author_id: report.author_id,
    author_handle: report.author_handle,
    coverage: report.coverage,
    counts: report.counts,
    validation: report.validation,
    risks: report.risks,
    honest_boundaries: profile.honest_boundaries || []
  };

  writeJson(path.join(outDir, "review-report.json"), report);
  writeJson(path.join(outDir, "review-summary.json"), summary);
  writeJson(path.join(outDir, "sample-units.json"), sampleUnits);
  writeFile(path.join(outDir, "sample-units.md"), buildSampleMarkdown(report, sampleUnits));
  writeFile(path.join(outDir, "review-checklist.md"), buildChecklist(report));
  writeJson(path.join(outDir, "manual-review-template.json"), buildManualReviewTemplate(report, sampleUnits));

  return {
    outDir,
    profile_id: report.profile_id,
    validation_status: report.validation.status,
    risks: report.risks,
    sample_units: sampleUnits
  };
}

module.exports = {
  exportReviewPack,
  selectSampleUnits,
  buildChecklist,
  buildManualReviewTemplate
};
