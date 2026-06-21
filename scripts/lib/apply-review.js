const fs = require("fs");
const path = require("path");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function countByStatus(items) {
  return (items || []).reduce((acc, item) => {
    const status = item.status || "unknown";
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
}

function summarizeManualReview(review, options = {}) {
  return {
    review_id: options.reviewId || `manual_review_${new Date().toISOString()}`,
    status: review.status || "pending",
    reviewer: review.reviewer || "",
    reviewed_at: review.reviewed_at || options.reviewedAt || new Date().toISOString(),
    overall_notes: review.overall_notes || "",
    pass_criteria: review.pass_criteria || {},
    domain_counts: countByStatus(review.domain_reviews || []),
    issue_count: (review.issue_log || []).length,
    domain_reviews: (review.domain_reviews || []).map((item) => ({
      domain: item.domain,
      status: item.status || "pending",
      notes: item.notes || "",
      sampled_unit_ids: item.sampled_unit_ids || []
    })),
    issue_log: review.issue_log || []
  };
}

function applyReviewToProfile(profile, review, options = {}) {
  if (review.profile_id && profile.profile_id && review.profile_id !== profile.profile_id) {
    const error = new Error(`Review profile_id ${review.profile_id} does not match profile ${profile.profile_id}`);
    error.code = "PROFILE_ID_MISMATCH";
    throw error;
  }
  const summary = summarizeManualReview(review, options);
  return {
    ...profile,
    review_results: [
      ...(Array.isArray(profile.review_results) ? profile.review_results : []),
      summary
    ],
    update_history: [
      ...(Array.isArray(profile.update_history) ? profile.update_history : []),
      {
        updated_at: summary.reviewed_at,
        event: "manual_review_applied",
        review_id: summary.review_id,
        status: summary.status,
        issue_count: summary.issue_count
      }
    ]
  };
}

function applyReviewToProfileFromFiles(options) {
  const review = readJson(options.reviewPath);
  const profile = readJson(options.profilePath);
  const updatedProfile = applyReviewToProfile(profile, review, {
    reviewId: options.reviewId
  });
  const outPath = options.outPath || options.profilePath;
  writeJson(outPath, updatedProfile);
  return {
    outPath,
    status: review.status || "pending",
    review_results: updatedProfile.review_results.length,
    latest_review: updatedProfile.review_results.at(-1)
  };
}

module.exports = {
  summarizeManualReview,
  applyReviewToProfile,
  applyReviewToProfileFromFiles
};
