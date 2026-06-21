const fs = require("fs");
const path = require("path");
const { answerQuestion } = require("./answer");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function includesAnyText(haystack, needles) {
  const text = JSON.stringify(haystack).toLowerCase();
  return needles.some((needle) => text.includes(String(needle).toLowerCase()));
}

function expectedModelMatched(answer, expectedModels = []) {
  if (!expectedModels.length) return true;
  const model = answer.likely_judgment_model;
  if (!model) return false;
  const haystack = [model.id, model.name, model.definition].join(" ").toLowerCase();
  return expectedModels.some((expected) => haystack.includes(String(expected).toLowerCase()));
}

function expectedVariablesMatched(answer, expectedVariables = []) {
  const variables = new Set((answer.key_variables || []).map((item) => String(item).toLowerCase()));
  return expectedVariables.every((variable) => variables.has(String(variable).toLowerCase()));
}

function passCriterionMatched(answer, criterion) {
  const normalized = String(criterion || "").toLowerCase();
  if (normalized.includes("cite") || normalized.includes("evidence") || normalized.includes("证据")) {
    return Array.isArray(answer.evidence_trace) && answer.evidence_trace.length > 0;
  }
  if (normalized.includes("confidence") || normalized.includes("boundary") || normalized.includes("边界") || normalized.includes("置信")) {
    return Boolean(answer.boundaries_and_confidence?.confidence) && (answer.boundaries_and_confidence?.boundaries || []).length > 0;
  }
  if (normalized.includes("refuse") || normalized.includes("unsupported") || normalized.includes("拒答")) {
    return (
      answer.action_tendency === "refuse_or_downgrade_confidence" ||
      answer.action_tendency === "拒答或降低置信度" ||
      answer.boundaries_and_confidence?.confidence === "low"
    );
  }
  if (normalized.includes("reason") || normalized.includes("推演") || normalized.includes("readable")) {
    return (
      typeof answer.reasoned_answer === "string" &&
      ((answer.reasoned_answer.includes("Direct answer:") && answer.reasoned_answer.includes("Evidence trace:")) ||
        (answer.reasoned_answer.includes("直接回答：") && answer.reasoned_answer.includes("证据链：")))
    );
  }
  return true;
}

function runValidationCase(testCase, context) {
  const answer = answerQuestion({
    question: testCase.question,
    profile: context.profile,
    units: context.units,
    config: context.config
  });
  const failures = [];

  if (!expectedModelMatched(answer, testCase.expected_models || [])) {
    failures.push(`expected model not matched: ${(testCase.expected_models || []).join(", ")}`);
  }
  if (!expectedVariablesMatched(answer, testCase.expected_variables || [])) {
    failures.push(`expected variables missing: ${(testCase.expected_variables || []).join(", ")}`);
  }
  if (includesAnyText(answer, testCase.must_not_include || [])) {
    failures.push(`answer includes forbidden text: ${(testCase.must_not_include || []).join(", ")}`);
  }
  for (const criterion of testCase.pass_criteria || []) {
    if (!passCriterionMatched(answer, criterion)) {
      failures.push(`pass criterion not met: ${criterion}`);
    }
  }

  return {
    case_id: testCase.case_id,
    status: failures.length ? "fail" : "pass",
    failures,
    answer
  };
}

function runValidationCases({ cases, profile, units, config }) {
  const results = cases.map((testCase) => runValidationCase(testCase, { profile, units, config }));
  const failed = results.filter((result) => result.status === "fail");
  return {
    status: failed.length ? "fail" : "pass",
    counts: {
      cases: results.length,
      passed: results.length - failed.length,
      failed: failed.length
    },
    results
  };
}

function runValidationCasesFromFiles(options) {
  const cases = readJson(options.casesPath);
  return runValidationCases({
    cases,
    profile: readJson(options.profilePath),
    units: readJson(options.unitsPath),
    config: readJson(options.configPath || path.join(process.cwd(), "configs/weibo.default.json"))
  });
}

function summarizeValidationReport(report, options = {}) {
  return {
    validation_id: options.validationId || `validation_${new Date().toISOString()}`,
    status: report.status,
    cases: report.counts.cases,
    passed: report.counts.passed,
    failed: report.counts.failed,
    case_results: report.results.map((result) => ({
      case_id: result.case_id,
      status: result.status,
      failures: result.failures
    })),
    generated_at: options.generatedAt || new Date().toISOString()
  };
}

function applyValidationResultsToProfile(profile, report, options = {}) {
  const validationSummary = summarizeValidationReport(report, options);
  return {
    ...profile,
    validation_results: [
      ...(Array.isArray(profile.validation_results) ? profile.validation_results : []),
      validationSummary
    ],
    update_history: [
      ...(Array.isArray(profile.update_history) ? profile.update_history : []),
      {
        updated_at: validationSummary.generated_at,
        event: "validation_results_applied",
        validation_id: validationSummary.validation_id,
        status: validationSummary.status,
        cases: validationSummary.cases
      }
    ]
  };
}

function applyValidationResultsToProfileFromFiles(options) {
  const profile = readJson(options.profilePath);
  const report = runValidationCasesFromFiles(options);
  const updatedProfile = applyValidationResultsToProfile(profile, report, {
    validationId: options.validationId
  });
  writeJson(options.outPath || options.profilePath, updatedProfile);
  return {
    outPath: options.outPath || options.profilePath,
    status: report.status,
    validation_results: updatedProfile.validation_results.length,
    latest_validation: updatedProfile.validation_results.at(-1)
  };
}

module.exports = {
  runValidationCase,
  runValidationCases,
  runValidationCasesFromFiles,
  summarizeValidationReport,
  applyValidationResultsToProfile,
  applyValidationResultsToProfileFromFiles
};
