const fs = require("fs");
const path = require("path");
const { normalizeWeiboRaw } = require("./pipeline");

const STOP_TERMS = new Set([
  "展开",
  "不是",
  "不要",
  "不能",
  "没有",
  "现在",
  "以后",
  "这个",
  "那个",
  "一个",
  "一种",
  "还是",
  "就是",
  "也是",
  "因为",
  "所以",
  "如果",
  "然后",
  "但是",
  "很多",
  "的人",
  "可能",
  "可以",
  "还有",
  "比如",
  "其实",
  "自己",
  "已经",
  "都是",
  "一样",
  "觉得",
  "或者",
  "也不",
  "是不",
  "比玄",
  "重要",
  "更重",
  "更重要",
  "先看",
  "只看",
  "别迷",
  "迷信"
]);

const STOP_SUBSTRINGS = ["微博", "视频", "观看", "展开"];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function slugTerm(term) {
  const ascii = String(term)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return ascii || `term_${Buffer.from(String(term)).toString("hex").slice(0, 12)}`;
}

function hanSequences(text) {
  return Array.from(String(text || "").matchAll(/\p{Script=Han}+/gu), (match) => match[0]);
}

function latinTerms(text) {
  return Array.from(String(text || "").matchAll(/[A-Za-z][A-Za-z0-9_-]{1,}/g), (match) => match[0].toLowerCase());
}

function cleanCorpusText(text) {
  return String(text || "")
    .replace(/@[\p{Script=Han}A-Za-z0-9_:-]{1,40}/gu, " ")
    .replace(/#[^#\n]{1,60}#/g, " ")
    .replace(/[\p{Script=Han}A-Za-z0-9_]{1,30}的微博视频/gu, " ")
    .replace(/[\p{Script=Han}A-Za-z0-9_]{1,30}\s*的微博/gu, " ")
    .replace(/\d+(?:\.\d+)?万?次观看/g, " ")
    .replace(/\d{1,2}:\d{2}/g, " ")
    .replace(/播放视频|自主创作|长图|展开/g, " ");
}

function candidateTerms(text) {
  const cleanText = cleanCorpusText(text);
  const terms = new Set(latinTerms(cleanText));
  for (const seq of hanSequences(cleanText)) {
    const chars = Array.from(seq);
    for (let size = 2; size <= Math.min(4, chars.length); size += 1) {
      for (let index = 0; index <= chars.length - size; index += 1) {
        const term = chars.slice(index, index + size).join("");
        if (!STOP_TERMS.has(term)) terms.add(term);
      }
    }
  }
  return Array.from(terms).filter((term) => {
    if (STOP_TERMS.has(term)) return false;
    if (STOP_SUBSTRINGS.some((substring) => term.includes(substring))) return false;
    if (term.startsWith("的") || term.endsWith("的")) return false;
    if (/^\d+$/.test(term)) return false;
    return term.length >= 2;
  });
}

function termStats(posts) {
  const stats = new Map();
  for (const post of posts) {
    const text = `${post.text} ${post.context_text || ""}`;
    const terms = candidateTerms(text);
    const uniqueTerms = new Set(terms);
    for (const term of terms) {
      const item = stats.get(term) || { term, count: 0, doc_count: 0, post_ids: new Set() };
      item.count += 1;
      stats.set(term, item);
    }
    for (const term of uniqueTerms) {
      stats.get(term).doc_count += 1;
      stats.get(term).post_ids.add(post.post_id);
    }
  }
  return Array.from(stats.values()).map((item) => ({
    term: item.term,
    count: item.count,
    doc_count: item.doc_count,
    post_ids: Array.from(item.post_ids),
    score: item.doc_count * 10 + item.count + Math.min(4, item.term.length)
  }));
}

function rankedTerms(posts, options = {}) {
  const minDocCount = Number(options.minDocCount || (posts.length >= 20 ? 2 : 1));
  return termStats(posts)
    .filter((item) => item.doc_count >= minDocCount)
    .sort((a, b) => b.score - a.score || b.doc_count - a.doc_count || a.term.localeCompare(b.term, "zh-Hans-CN"));
}

function buildDomains(posts, terms, options = {}) {
  const maxDomains = Number(options.maxDomains || 6);
  const maxKeywords = Number(options.maxKeywords || 10);
  const domains = {};
  const consumed = new Set();
  const termsByPost = new Map();
  for (const item of terms) {
    for (const postId of item.post_ids) {
      const list = termsByPost.get(postId) || [];
      list.push(item);
      termsByPost.set(postId, list);
    }
  }

  let domainIndex = 1;
  for (const seed of terms) {
    if (domainIndex > maxDomains) break;
    if (consumed.has(seed.term)) continue;
    const coTerms = new Map();
    for (const postId of seed.post_ids) {
      for (const item of termsByPost.get(postId) || []) {
        if (consumed.has(item.term)) continue;
        const existing = coTerms.get(item.term) || { ...item, co_docs: 0 };
        existing.co_docs += 1;
        coTerms.set(item.term, existing);
      }
    }
    const keywords = Array.from(coTerms.values())
      .sort((a, b) => b.co_docs - a.co_docs || b.score - a.score || a.term.localeCompare(b.term, "zh-Hans-CN"))
      .slice(0, maxKeywords)
      .map((item) => item.term);
    if (keywords.length < 3) continue;

    const domainId = `discovered_${String(domainIndex).padStart(2, "0")}_${slugTerm(seed.term)}`;
    domains[domainId] = {
      name: `Discovered topic: ${keywords.slice(0, 3).join(" / ")}`,
      keywords,
      variables: keywords.slice(0, 6).map((keyword, index) => `keyword_${index + 1}_${slugTerm(keyword)}`),
      model_template: `Corpus-discovered topic centered on ${keywords.slice(0, 3).join(", ")}. Review and rename this domain before serious use.`
    };
    for (const keyword of keywords) consumed.add(keyword);
    domainIndex += 1;
  }
  return domains;
}

function suggestWeiboConfig(raw, options = {}) {
  const posts = normalizeWeiboRaw(raw, options);
  const terms = rankedTerms(posts, options);
  const domains = buildDomains(posts, terms, options);
  return {
    config: {
      version: "0.1.0",
      platform: "weibo",
      domains,
      anti_pattern_keywords: {
        old_rule_extrapolation: ["以前", "去年", "过去", "老办法"],
        shortcut_over_process: ["偷懒", "玄学", "迷信", "只看"],
        moral_framing_without_mechanism: ["应该", "必须", "道德", "口号"]
      }
    },
    source_summary: {
      posts: posts.length,
      candidate_terms: terms.length,
      suggested_domains: Object.keys(domains).length
    },
    top_terms: terms.slice(0, 30).map(({ term, count, doc_count, score }) => ({ term, count, doc_count, score })),
    review_notes: [
      "This is a starter config, not a finished author judgment model.",
      "Review domain names, delete noisy keywords, and rename variables before serious use.",
      "Run distill-weibo or export-llm-batches with this config after review."
    ]
  };
}

function suggestWeiboConfigFromFile(options) {
  const suggestion = suggestWeiboConfig(readJson(options.rawPath), options);
  if (options.outPath) writeJson(options.outPath, suggestion.config);
  return {
    outPath: options.outPath || "",
    source_summary: suggestion.source_summary,
    top_terms: suggestion.top_terms,
    review_notes: suggestion.review_notes,
    config: suggestion.config
  };
}

module.exports = {
  candidateTerms,
  suggestWeiboConfig,
  suggestWeiboConfigFromFile
};
