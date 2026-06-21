#!/usr/bin/env node
const http = require("http");
const fs = require("fs");
const path = require("path");
const { packageAuthorUnit } = require("./lib/package-author");
const { fetchMarketContext } = require("./lib/market-context");

const root = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || 8000);

const authors = {
  sanshu: {
    name: "三叔",
    reviewPath: "dist/weibo-2611641261-pruned/review/concepts/concept-review-template.json",
    profilePath: "dist/weibo-2611641261-pruned/data/profiles/weibo-2611641261/author-judgment-profile.json",
    unitsPath: "dist/weibo-2611641261-pruned/pruned-judgment-units.json",
    configPath: "configs/weibo.default.json",
    packageDir: "dist/weibo-2611641261-pruned/package"
  },
  jianfang: {
    name: "交易者简放",
    reviewPath: "dist/weibo-1357064103-pruned/review/concepts/concept-review-template.json",
    profilePath: "dist/weibo-1357064103-pruned/data/profiles/weibo-1357064103/author-judgment-profile.json",
    unitsPath: "dist/weibo-1357064103-pruned/pruned-judgment-units.json",
    configPath: "configs/weibo-1357064103.jianfang.json",
    packageDir: "dist/weibo-1357064103-pruned/package"
  },
  tj_research: {
    name: "投资TALK君",
    reviewPath: "dist/x-tj-research-pruned/review/concepts/concept-review-template.json",
    profilePath: "dist/x-tj-research-pruned/data/profiles/x-1620475218627121153/author-judgment-profile.json",
    unitsPath: "dist/x-tj-research-pruned/pruned-judgment-units.json",
    configPath: "configs/x-tj-research.json",
    packageDir: "dist/x-tj-research-pruned/package"
  }
};

function abs(relativePath) {
  return path.join(root, relativePath);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function sendText(res, status, value) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(value);
}

function requestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function profileConcept(concept) {
  return {
    id: concept.id,
    name: concept.name || concept.id,
    aliases: concept.aliases || [],
    domains: concept.domains || [],
    trigger_conditions: concept.trigger_conditions || [],
    required_variables: concept.required_variables || [],
    boundary_conditions: concept.boundary_conditions || [],
    counterexamples: concept.counterexamples || [],
    time_scope: concept.time_scope || "",
    evidence_unit_ids: concept.evidence_unit_ids || []
  };
}

function applyAcceptedConcepts(authorId, acceptedIds) {
  const author = authors[authorId];
  if (!author) throw new Error(`Unknown author ${authorId}`);

  const accepted = new Set(acceptedIds || []);
  const reviewPath = abs(author.reviewPath);
  const profilePath = abs(author.profilePath);
  const review = readJson(reviewPath);
  const profile = readJson(profilePath);
  const now = new Date().toISOString();

  review.concepts = (review.concepts || []).map((concept) => ({
    ...concept,
    review_decision: accepted.has(concept.id) ? "accept" : "reject"
  }));
  review.last_applied_at = now;
  writeJson(reviewPath, review);

  const acceptedConcepts = review.concepts.filter((concept) => concept.review_decision === "accept").map(profileConcept);
  const merged = new Map((profile.concepts || []).map((concept) => [concept.id, concept]));
  for (const concept of acceptedConcepts) merged.set(concept.id, concept);
  const updatedProfile = {
    ...profile,
    concepts: Array.from(merged.values()),
    update_history: [
      ...(profile.update_history || []),
      {
        updated_at: now,
        event: "concepts_applied_from_site",
        review_id: `${authorId}_site_concept_review`,
        accepted: acceptedConcepts.length
      }
    ]
  };
  writeJson(profilePath, updatedProfile);

  const packaged = packageAuthorUnit({
    profilePath,
    unitsPath: abs(author.unitsPath),
    configPath: abs(author.configPath),
    outDir: abs(author.packageDir)
  });

  return {
    author: author.name,
    accepted: acceptedConcepts.length,
    profile_concepts: updatedProfile.concepts.length,
    profilePath,
    reviewPath,
    packageDir: packaged.outDir
  };
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return (
    {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".md": "text/markdown; charset=utf-8"
    }[ext] || "application/octet-stream"
  );
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://localhost:${port}`);
  const safePath = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(root, safePath === "/" ? "dist/author-judgment-site/index.html" : safePath);
  if (!filePath.startsWith(root)) {
    sendText(res, 403, "Forbidden");
    return;
  }
  fs.stat(filePath, (statError, stat) => {
    if (statError || !stat.isFile()) {
      sendText(res, 404, "Not found");
      return;
    }
    res.writeHead(200, {
      "content-type": contentType(filePath),
      "cache-control": "no-store"
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/api/concepts/apply") {
      const body = JSON.parse((await requestBody(req)) || "{}");
      sendJson(res, 200, applyAcceptedConcepts(body.authorId, body.acceptedIds || []));
      return;
    }
    if (req.method === "GET" && req.url === "/api/health") {
      sendJson(res, 200, { ok: true, authors: Object.keys(authors) });
      return;
    }
    if (req.method === "GET" && req.url.startsWith("/api/market-context")) {
      const url = new URL(req.url, `http://localhost:${port}`);
      const question = url.searchParams.get("question") || "";
      const provider = url.searchParams.get("provider") || "auto";
      if (!question.trim()) {
        sendJson(res, 400, { error: "question is required" });
        return;
      }
      const result = await fetchMarketContext({ question, provider });
      sendJson(res, 200, result);
      return;
    }
    if (req.method === "GET" || req.method === "HEAD") {
      serveStatic(req, res);
      return;
    }
    sendText(res, 405, "Method not allowed");
  } catch (error) {
    sendJson(res, 500, { error: error.message || String(error) });
  }
});

server.listen(port, () => {
  console.log(`AJM concept review server running at http://localhost:${port}/dist/author-judgment-site/index.html`);
});
