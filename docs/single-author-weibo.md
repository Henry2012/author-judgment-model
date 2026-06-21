# Single-Author Weibo AJM Pipeline

This document defines the first executable slice of AJM: turning one Sina Weibo author's raw corpus into reusable judgment artifacts.

For repeatable execution on a new author, use `docs/single-author-runbook.md` as the command-by-command spec. This document explains the pipeline and available commands.

## Scope

The pipeline is generic for Weibo raw indexes shaped like the San Shu prototype:

- top-level `rows`
- row fields such as `id`, `bid`, `created_at`, `text`, `url`, `capture_method`, `captured_at`, `attitudes_count`, `comments_count`, and `reposts_count`

It is not hard-coded to San Shu. The author is inferred from `target` or passed with `--author-id`.

## Latest Verified San Shu Outputs

The latest verified San Shu outputs in this repository are:

- Wide coverage unit: `dist/weibo-2611641261`
  - 3447 judgment units
  - baseline validation persisted
  - quality gate: `warn`, because low-confidence unit ratio is high
- Strict unit: `dist/weibo-2611641261-pruned`
  - 1204 judgment units
  - 6 mental models
  - baseline validation: 7/7 pass
  - quality gate: `pass`, score 100
  - recommended package: `dist/weibo-2611641261-pruned/package`

Use the strict package for serious local Agent/Skill/QA use. Use the wide coverage unit only when recall matters more than noise and the warning is acceptable.

## Recommended One-Command Flow

Use `build-weibo-author-unit` when you want a complete local single-author unit from a Weibo raw index:

```sh
node scripts/ajm.js build-weibo-author-unit \
  --raw /path/to/raw-index.json \
  --author-id 2611641261 \
  --author-handle sanshu \
  --out dist/weibo-2611641261 \
  --validation-cases data/validation/weibo-2611641261/validation-cases.json \
  --validation-id sanshu_baseline_validation_001
```

This command produces the full handoff structure:

- `data/`: normalized posts, judgment units, evidence maps, and profile
- `review/`: machine report, sampled evidence, quality gate, checklist, and manual review template
- `package/`: Agent prompt, Skill skeleton, QA entrypoint, manifest, and data files
- `build-manifest.json`: paths, counts, risks, and stage summary

If the quality gate returns `fail`, package generation is blocked by default. The command still writes `data/`, `review/`, `quality-gate.json`, and `build-manifest.json` so the failed build can be inspected and corrected before packaging. Use `--allow-package-on-fail true` only for local debugging.

For a new Weibo author, change `--raw`, optionally pass `--author-id` and `--author-handle`, and use a matching `--config` if the author's domains are not covered by `configs/weibo.default.json`.

Use `--suggest-config yes` if you need a first draft config generated inside the output directory:

```sh
node scripts/ajm.js build-weibo-author-unit \
  --raw /path/to/raw-index.json \
  --author-handle author_handle \
  --out dist/author_handle \
  --suggest-config yes \
  --max-domains 6
```

Review the generated config before serious use.

Use `distill-weibo` when you only want the core data artifacts without the review and usage package:

```sh
node scripts/ajm.js distill-weibo \
  --raw /path/to/raw-index.json \
  --author-id 2611641261 \
  --author-handle sanshu \
  --out data \
  --validation-cases data/validation/weibo-2611641261/validation-cases.json \
  --validation-id sanshu_baseline_validation_001
```

This command writes the same core artifacts as `build-weibo`, optionally runs validation cases, persists the validation summary into the profile, and returns a compact review report with counts, validation status, and risks.

## Arbitrary Author Starter Config

For an author whose topics are not covered by `configs/weibo.default.json`, first generate a starter config from the raw corpus:

```sh
node scripts/ajm.js suggest-weibo-config \
  --raw /path/to/raw-index.json \
  --author-handle author_handle \
  --out configs/weibo.author.json \
  --max-domains 6
```

The generated config is intentionally a draft. Review it before serious use:

- rename discovered domains into human-readable topic names
- delete noisy keywords
- rename variables from keyword placeholders into judgment variables
- add missing anti-pattern keywords if the author repeatedly rejects a reasoning pattern

Then run:

```sh
node scripts/ajm.js distill-weibo \
  --raw /path/to/raw-index.json \
  --config configs/weibo.author.json \
  --out data
```

If you already have reviewed LLM extraction results, pass them directly into the same command:

```sh
node scripts/ajm.js distill-weibo \
  --raw /path/to/raw-index.json \
  --author-id 2611641261 \
  --author-handle sanshu \
  --out data \
  --llm-results data/llm-batches/weibo-2611641261/results.jsonl \
  --unit-prefix reviewed_unit \
  --validation-cases data/validation/weibo-2611641261/validation-cases.json
```

With `--llm-results`, the command still normalizes the raw Weibo corpus first, then imports the reviewed LLM units, rebuilds evidence maps/profile from those units, applies optional validation cases, and reports final artifact health.

## Build Command

```sh
node scripts/ajm.js build-weibo \
  --raw /path/to/raw-index.json \
  --author-id 2611641261 \
  --author-handle sanshu \
  --out data
```

## Outputs

For author `2611641261`, the command writes:

- `data/normalized/weibo-2611641261/posts.json`
- `data/judgment-units/weibo-2611641261/judgment-units.json`
- `data/evidence-maps/weibo-2611641261/evidence-maps.json`
- `data/profiles/weibo-2611641261/author-judgment-profile.json`

## Current Extraction Level

The shipped extractor is a deterministic baseline with review, validation, quality-gate, and pruning layers around it:

- classifies posts by configurable Weibo domain keywords
- emits candidate judgment units with evidence excerpts
- builds evidence maps and a profile from recurring domain evidence
- preserves boundaries that prevent persona imitation and unsupported real-time claims
- generates review packs and baseline validation cases
- writes validation and review summaries back into the profile
- can rebuild artifacts after manual review corrections
- can create a stricter pruned unit by removing weak or low-confidence units

This is intentionally conservative. LLM batch extraction is now an optional quality/coverage enhancement, not a prerequisite for the latest single-author package. For serious use today, prefer a quality-gated package, and use the pruned package when low noise matters more than broad recall.

## LLM Batch Extraction

For higher-quality judgment units, export normalized posts into JSONL batch requests:

```sh
node scripts/ajm.js export-llm-batches \
  --posts data/normalized/weibo-2611641261/posts.json \
  --out data/llm-batches/weibo-2611641261/requests.jsonl \
  --batch-size 20
```

Each JSONL line contains:

- `batch_id`
- extraction instructions
- configured domains and variables
- a bounded list of posts with `post_id`, `created_at`, `text`, `context_text`, and `url`

Run those requests through the model provider of choice. Save provider outputs as JSONL where each line has:

```json
{
  "batch_id": "batch_00001",
  "judgment_units": [
    {
      "source_post_id": "post id from input",
      "domain": "configured domain id or general",
      "claim": "short evidence-backed judgment claim",
      "object": "what the judgment is about",
      "stance": "author stance label",
      "variables": ["decision variable"],
      "causal_chain": ["cause", "mechanism", "effect"],
      "decision_rule": "if applicable",
      "anti_patterns": ["rejected pattern"],
      "confidence": "low|medium|high",
      "evidence_strength": "weak|indirect|direct",
      "evidence_excerpt": "short excerpt from source post"
    }
  ]
}
```

You can run the JSONL requests with an OpenAI-compatible chat completions endpoint:

```sh
node scripts/ajm.js run-llm-batches \
  --requests data/llm-batches/weibo-2611641261/requests.jsonl \
  --results data/llm-batches/weibo-2611641261/results.jsonl \
  --model gpt-5.5 \
  --api-key-env OPENAI_API_KEY
```

The runner is resumable. Existing `batch_id` rows in `results.jsonl` are skipped, and new results are appended. Use `--limit 5` for a small smoke run before a full extraction.

Import model results back into canonical judgment units:

```sh
node scripts/ajm.js import-llm-units \
  --posts data/normalized/weibo-2611641261/posts.json \
  --results data/llm-batches/weibo-2611641261/results.jsonl \
  --out data/judgment-units/weibo-2611641261/llm-judgment-units.json
```

Rebuild the profile and evidence maps from the imported LLM units:

```sh
node scripts/ajm.js rebuild-profile \
  --posts data/normalized/weibo-2611641261/posts.json \
  --units data/judgment-units/weibo-2611641261/llm-judgment-units.json \
  --author-id 2611641261 \
  --author-handle sanshu \
  --out data
```

The import and rebuild steps can also be collapsed into `distill-weibo --llm-results`, which is the recommended path after human review of `results.jsonl`.

## Acceptance Gate

Run:

```sh
npm test
```

Then run the full sample distillation:

```sh
node scripts/ajm.js distill-weibo \
  --raw ./examples/weibo-2611641261/raw-index.json \
  --author-id 2611641261 \
  --author-handle sanshu \
  --out data \
  --validation-cases data/validation/weibo-2611641261/validation-cases.json \
  --validation-id sanshu_baseline_validation_001
```

Or run only the baseline artifact build:

```sh
npm run build:weibo:sanshu
```

Ask the generated single-author unit:

```sh
node scripts/ajm.js answer \
  --profile data/profiles/weibo-2611641261/author-judgment-profile.json \
  --units data/judgment-units/weibo-2611641261/judgment-units.json \
  --question "现在买房主要要看什么？"
```

The answer output includes both machine-readable fields and a `reasoned_answer` paragraph. The paragraph is evidence-bounded and analytical; it should not imitate the author's voice or claim to represent the author personally.

Validate the generated artifacts:

```sh
node scripts/ajm.js validate \
  --posts data/normalized/weibo-2611641261/posts.json \
  --units data/judgment-units/weibo-2611641261/judgment-units.json \
  --evidence-maps data/evidence-maps/weibo-2611641261/evidence-maps.json \
  --profile data/profiles/weibo-2611641261/author-judgment-profile.json
```

Run validation cases against the answer engine:

```sh
node scripts/ajm.js run-validation-cases \
  --cases data/validation/weibo-2611641261/validation-cases.json \
  --profile data/profiles/weibo-2611641261/author-judgment-profile.json \
  --units data/judgment-units/weibo-2611641261/judgment-units.json
```

If you do not have hand-written known-stance cases yet, generate a baseline smoke set from the profile:

```sh
node scripts/ajm.js generate-validation-cases \
  --profile data/profiles/weibo-2611641261/author-judgment-profile.json \
  --config configs/weibo.default.json \
  --out data/validation/weibo-2611641261/validation-cases.generated.json \
  --max-domains 6 \
  --case-prefix sanshu
```

The generated cases cover the highest-evidence mental models plus one unsupported-topic boundary case. Treat them as a baseline QA smoke set; for serious use, add hand-written known-stance cases from important source posts.

Persist validation results into the profile:

```sh
node scripts/ajm.js apply-validation-results \
  --cases data/validation/weibo-2611641261/validation-cases.json \
  --profile data/profiles/weibo-2611641261/author-judgment-profile.json \
  --units data/judgment-units/weibo-2611641261/judgment-units.json
```

Generate a human-reviewable profile report:

```sh
node scripts/ajm.js report \
  --posts data/normalized/weibo-2611641261/posts.json \
  --units data/judgment-units/weibo-2611641261/judgment-units.json \
  --evidence-maps data/evidence-maps/weibo-2611641261/evidence-maps.json \
  --profile data/profiles/weibo-2611641261/author-judgment-profile.json
```

Export a manual review pack before serious use:

```sh
node scripts/ajm.js review-pack \
  --posts data/normalized/weibo-2611641261/posts.json \
  --units data/judgment-units/weibo-2611641261/judgment-units.json \
  --evidence-maps data/evidence-maps/weibo-2611641261/evidence-maps.json \
  --profile data/profiles/weibo-2611641261/author-judgment-profile.json \
  --out reviews/weibo-2611641261 \
  --samples-per-domain 3
```

The review pack contains:

- `review-report.json`: machine validation, risks, counts, domains, and top evidence
- `review-summary.json`: compact package health summary
- `quality-gate.json`: pass/warn/fail quality gate for serious-use readiness
- `sample-units.json`: sampled high-impact units by domain
- `sample-units.md`: human-readable evidence samples
- `review-checklist.md`: pass criteria and review questions
- `manual-review-template.json`: reviewer-fillable status and issue log

Use this as the "machine batch extraction + focused human spot check" gate. A serious-use profile should not be packaged until evidence grounding, domain labels, variables, unsupported-topic boundaries, and known-stance validation have been reviewed.

Run the quality gate directly when you want a machine-readable readiness check:

```sh
node scripts/ajm.js quality-gate \
  --posts data/normalized/weibo-2611641261/posts.json \
  --units data/judgment-units/weibo-2611641261/judgment-units.json \
  --evidence-maps data/evidence-maps/weibo-2611641261/evidence-maps.json \
  --profile data/profiles/weibo-2611641261/author-judgment-profile.json \
  --out reviews/weibo-2611641261/quality-gate.json
```

Quality gate statuses:

- `pass`: artifacts are valid and no machine-detected readiness warnings remain
- `warn`: artifacts are usable for review, but need more corpus, validation cases, config cleanup, or manual checks
- `fail`: artifact validation or classification quality blocks serious use

If the remaining warning is `high_low_confidence_unit_ratio`, create a stricter pruned build:

```sh
node scripts/ajm.js prune-weak-units \
  --posts data/normalized/weibo-2611641261/posts.json \
  --units data/judgment-units/weibo-2611641261/judgment-units.json \
  --profile data/profiles/weibo-2611641261/author-judgment-profile.json \
  --out pruned/weibo-2611641261 \
  --config configs/weibo.default.json
```

This writes `pruned-judgment-units.json`, rebuilds evidence maps/profile under `data/`, preserves existing review and validation summaries from the input profile, reruns `quality-gate`, and writes `weak-unit-report.json`. Use the pruned paths for a stricter package when you prefer lower noise over broad coverage.

After a reviewer fills `manual-review-template.json`, write the review summary back into the profile:

```sh
node scripts/ajm.js apply-review \
  --review reviews/weibo-2611641261/manual-review-template.json \
  --profile data/profiles/weibo-2611641261/author-judgment-profile.json \
  --out data/profiles/weibo-2611641261/author-judgment-profile.reviewed.json \
  --review-id sanshu_manual_review_001
```

The minimal `apply-review` flow records reviewer, status, pass criteria, domain statuses, notes, and issue count into `profile.review_results`, then appends a `manual_review_applied` event to `profile.update_history`. It does not automatically delete or rewrite judgment units; use the correction command below when review decisions should change the artifacts.

To execute review corrections, use `apply-review-corrections`:

```sh
node scripts/ajm.js apply-review-corrections \
  --review reviews/weibo-2611641261/manual-review-template.json \
  --posts data/normalized/weibo-2611641261/posts.json \
  --units data/judgment-units/weibo-2611641261/judgment-units.json \
  --out corrections/weibo-2611641261 \
  --review-id sanshu_manual_review_001
```

Correction rules:

- `domain_reviews[].status = "rejected"` removes that domain's sampled units
- `domain_reviews[].status = "needs_revision"` keeps sampled units but marks them with `review_status` and `review_notes`
- `issue_log[]` entries with `item_type: "unit"` and `action: "reject"` remove the exact unit; `action: "needs_revision"` marks the exact unit

The correction flow writes `corrected-judgment-units.json`, rebuilds evidence maps and the profile under `data/`, applies the review summary to the rebuilt profile, reruns `quality-gate`, and writes `correction-report.json`. Use the corrected paths for the next `package-author` run.

## Usage Package

After distillation, export a local usage package:

```sh
node scripts/ajm.js package-author \
  --profile data/profiles/weibo-2611641261/author-judgment-profile.json \
  --units data/judgment-units/weibo-2611641261/judgment-units.json \
  --config configs/weibo.default.json \
  --out dist/weibo-2611641261
```

The package contains:

- `agent-prompt.md`: prompt instructions for an evidence-bounded AJM agent
- `SKILL.md`: a portable skill skeleton for this distilled author unit
- `qa.md`: local QA entrypoint instructions
- `manifest.json`: package metadata and counts
- `data/author-judgment-profile.json`
- `data/judgment-units.json`
- `data/config.json`

This package is the practical handoff format. It does not install a global skill automatically; it gives the Agent, Skill, and QA forms needed for review, packaging, or later installation.

## Custom Domains

For another Weibo author, create a config shaped like `configs/weibo.default.json` and pass it with `--config`.

Each domain should define:

- `keywords`: terms used to classify raw posts
- `variables`: judgment variables to preserve in units and answers
- `model_template`: the default corpus-backed judgment statement for that domain
