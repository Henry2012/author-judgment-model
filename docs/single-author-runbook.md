# Single-Author AJM Runbook

This runbook is the executable spec for building one single-author AJM package from a Weibo raw information stream.

Use it as the source of truth for repeatable execution. Do not skip gates. Do not mix files from different output directories.

## 0. Inputs

Required:

- `RAW_PATH`: path to the author's Weibo `raw-index.json`
- `AUTHOR_ID`: author id, for example `2611641261`
- `AUTHOR_HANDLE`: stable local handle, for example `sanshu`
- `AUTHOR_SLUG`: `weibo-${AUTHOR_ID}`
- `OUT_DIR`: `dist/${AUTHOR_SLUG}`
- `STRICT_DIR`: `dist/${AUTHOR_SLUG}-pruned`
- `CONFIG_PATH`: normally `configs/weibo.default.json`

Optional:

- `VALIDATION_ID`: `${AUTHOR_HANDLE}_baseline_generated_001`
- `CASE_PREFIX`: `${AUTHOR_HANDLE}`

Before running:

```sh
npm test
```

Acceptance:

- Test command exits `0`.

## 0.1. AJM v2.1 Semantic Distillation Gate

The final package must preserve semantic concepts, not just keyword/domain matches. Concepts can come from a reviewed author config or from v2.1 concept discovery.

Required extraction targets:

- judgment variables
- trigger conditions
- boundary conditions
- counterexamples
- time applicability
- confidence reasons
- misuse risks

Acceptance:

- LLM batch prompts include `trigger_conditions`, `boundary_conditions`, `counterexamples`, and `time_scope`.
- Imported judgment units preserve these fields when model extraction provides them.
- If `CONFIG_PATH` defines `concepts`, the generated profile contains `profile.concepts`.
- A concept must include aliases, linked domains, trigger conditions, boundary conditions, counterexamples, time scope, and evidence unit ids when evidence exists.
- QA answers for concept questions must expose `matched_concept`, `trigger_conditions`, and `boundary_conditions`.
- The browser package must classify concept-alias questions through the same concept layer as the CLI answer engine.
- v2.1 concept discovery must produce `concept-candidates.json`, `concept-review-template.json`, and `concept-review.md`.
- Accepted concepts from `concept-review-template.json` must be written into `profile.concepts` before final packaging.

## 0.2. AJM v2.4 Core Asset Routing Gate

For investment or market authors, core market objects must be forced-routable before ordinary keyword scoring. They are not optional concepts and must not depend on accidental keyword overlap.

Required routable objects:

- US indices: `QQQ`, `SPY`, Nasdaq / 纳指, S&P 500 / 标普, `RSP`, `IWM`
- US big tech: 大科技, Microsoft / `MSFT`, Apple / `AAPL`, Amazon / `AMZN`, Google / `GOOGL`, Meta / `META`
- AI / semiconductors: 半导体, 算力, `NVDA`, `AMD`, `AVGO`, `TSM`, `ASML`, `QCOM`, `MU`
- Crypto: `BTC`, `ETH`, stablecoin / 稳定币, `COIN`, `MSTR`
- China assets: 港股, 中概, 中国资产, `KWEB`, `FXI`, `BABA`, `PDD`, Tencent / 腾讯

Acceptance:

- `scripts/lib/core-assets.js` contains a route for each required object group.
- CLI answer classification routes each object group to the strongest available author domain before fallback keyword scoring.
- Browser package classification uses the same core asset routing behavior as the CLI.
- Market context generation maps each object group to an explicit Futu/public data basket.
- Regression tests cover QQQ/SPY, big tech, semiconductors, BTC/crypto, and Hong Kong/China ADR questions.

## 1. Build First-Pass Author Unit

```sh
node scripts/ajm.js build-weibo-author-unit \
  --raw "$RAW_PATH" \
  --author-id "$AUTHOR_ID" \
  --author-handle "$AUTHOR_HANDLE" \
  --out "$OUT_DIR" \
  --config "$CONFIG_PATH" \
  --samples-per-domain 3
```

Expected outputs:

- `$OUT_DIR/data/normalized/$AUTHOR_SLUG/posts.json`
- `$OUT_DIR/data/judgment-units/$AUTHOR_SLUG/judgment-units.json`
- `$OUT_DIR/data/evidence-maps/$AUTHOR_SLUG/evidence-maps.json`
- `$OUT_DIR/data/profiles/$AUTHOR_SLUG/author-judgment-profile.json`
- `$OUT_DIR/review/manual-review-template.json`
- `$OUT_DIR/review/quality-gate.json`
- `$OUT_DIR/package/agent-prompt.md`, unless quality gate is `fail`
- `$OUT_DIR/package/SKILL.md`, unless quality gate is `fail`
- `$OUT_DIR/package/qa.md`, unless quality gate is `fail`

Acceptance:

- Command exits `0`, or exits non-zero only because quality gate is `fail`.
- If quality gate is `fail`, inspect `$OUT_DIR/build-manifest.json` and fix the blocking issues before packaging.
- If quality gate is `warn`, continue only for review/validation/pruning.

## 2. Generate Baseline Validation Cases

```sh
node scripts/ajm.js generate-validation-cases \
  --profile "$OUT_DIR/data/profiles/$AUTHOR_SLUG/author-judgment-profile.json" \
  --config "$CONFIG_PATH" \
  --out "$OUT_DIR/validation/validation-cases.generated.json" \
  --max-domains 6 \
  --case-prefix "$CASE_PREFIX"
```

Expected output:

- `$OUT_DIR/validation/validation-cases.generated.json`

Acceptance:

- File exists.
- It includes at least one covered-domain case.
- It includes one unsupported-topic boundary case.

## 3. Run Baseline Validation Cases

```sh
node scripts/ajm.js run-validation-cases \
  --cases "$OUT_DIR/validation/validation-cases.generated.json" \
  --profile "$OUT_DIR/data/profiles/$AUTHOR_SLUG/author-judgment-profile.json" \
  --units "$OUT_DIR/data/judgment-units/$AUTHOR_SLUG/judgment-units.json" \
  --config "$CONFIG_PATH"
```

Acceptance:

- Command exits `0`.
- Validation status is `pass`.
- Failed case count is `0`.

If validation fails:

- Do not package for serious use.
- Inspect failing case ids.
- Fix domain config, extraction results, or validation cases.
- Rerun this step.

## 4. Persist Validation Results

```sh
node scripts/ajm.js apply-validation-results \
  --cases "$OUT_DIR/validation/validation-cases.generated.json" \
  --profile "$OUT_DIR/data/profiles/$AUTHOR_SLUG/author-judgment-profile.json" \
  --units "$OUT_DIR/data/judgment-units/$AUTHOR_SLUG/judgment-units.json" \
  --config "$CONFIG_PATH" \
  --validation-id "$VALIDATION_ID"
```

Acceptance:

- Command exits `0`.
- Profile contains `validation_results`.
- Latest validation result has status `pass`.

## 5. Re-run Quality Gate

```sh
node scripts/ajm.js quality-gate \
  --posts "$OUT_DIR/data/normalized/$AUTHOR_SLUG/posts.json" \
  --units "$OUT_DIR/data/judgment-units/$AUTHOR_SLUG/judgment-units.json" \
  --evidence-maps "$OUT_DIR/data/evidence-maps/$AUTHOR_SLUG/evidence-maps.json" \
  --profile "$OUT_DIR/data/profiles/$AUTHOR_SLUG/author-judgment-profile.json" \
  --out "$OUT_DIR/review/quality-gate.json"
```

Acceptance:

- `blocking_issues` is empty.
- `validation_results_not_embedded_in_profile` is absent.

Gate handling:

- `pass`: package can be used.
- `warn` with `high_low_confidence_unit_ratio`: continue to Step 6.
- any other `warn`: inspect recommendations and resolve or document.
- `fail`: do not package.

## 6. Create Strict Pruned Unit

Run this step when quality gate warns on weak or low-confidence units, or when the final package must prioritize low noise.

```sh
node scripts/ajm.js prune-weak-units \
  --posts "$OUT_DIR/data/normalized/$AUTHOR_SLUG/posts.json" \
  --units "$OUT_DIR/data/judgment-units/$AUTHOR_SLUG/judgment-units.json" \
  --profile "$OUT_DIR/data/profiles/$AUTHOR_SLUG/author-judgment-profile.json" \
  --out "$STRICT_DIR" \
  --config "$CONFIG_PATH" \
  --author-id "$AUTHOR_ID" \
  --author-handle "$AUTHOR_HANDLE"
```

Expected outputs:

- `$STRICT_DIR/pruned-judgment-units.json`
- `$STRICT_DIR/weak-unit-report.json`
- `$STRICT_DIR/quality-gate.json`
- `$STRICT_DIR/data/evidence-maps/$AUTHOR_SLUG/evidence-maps.json`
- `$STRICT_DIR/data/profiles/$AUTHOR_SLUG/author-judgment-profile.json`

Acceptance:

- Quality gate is `pass`.
- `blocking_issues` is empty.
- `warnings` is empty.
- `low_confidence_unit_ratio` is `0`.
- Profile still contains validation results.

If pruning removes too much coverage:

- Keep both `$OUT_DIR` and `$STRICT_DIR`.
- Use `$STRICT_DIR` for low-noise serious use.
- Use `$OUT_DIR` only for exploratory review.

## 7. Validate Strict Unit

```sh
node scripts/ajm.js run-validation-cases \
  --cases "$OUT_DIR/validation/validation-cases.generated.json" \
  --profile "$STRICT_DIR/data/profiles/$AUTHOR_SLUG/author-judgment-profile.json" \
  --units "$STRICT_DIR/pruned-judgment-units.json" \
  --config "$CONFIG_PATH"
```

Acceptance:

- Command exits `0`.
- Validation status is `pass`.
- Failed case count is `0`.

## 7.1. Discover, Review, and Apply Concepts

Run this step after choosing the final unit source. Prefer the strict unit when available.

```sh
node scripts/ajm.js discover-concepts \
  --units "$STRICT_DIR/pruned-judgment-units.json" \
  --out "$STRICT_DIR/review/concepts" \
  --min-evidence-units 3 \
  --max-candidates 30
```

For trading authors, use v2.2 structural concept discovery:

```sh
node scripts/ajm.js discover-concepts \
  --units "$STRICT_DIR/pruned-judgment-units.json" \
  --out "$STRICT_DIR/review/concepts" \
  --min-evidence-units 3 \
  --max-candidates 30 \
  --strategy trading
```

Expected outputs:

- `$STRICT_DIR/review/concepts/concept-candidates.json`
- `$STRICT_DIR/review/concepts/concept-review-template.json`
- `$STRICT_DIR/review/concepts/concept-review.md`

Human review:

- Open `concept-review.md` for a readable summary.
- Edit `concept-review-template.json`.
- Keep `review_decision: "accept"` only for real recurring concepts.
- Set noisy or pseudo concepts to `review_decision: "reject"`.
- Merge or rename aliases, trigger conditions, boundary conditions, and counterexamples when needed.

Apply accepted concepts:

```sh
node scripts/ajm.js apply-concept-review \
  --review "$STRICT_DIR/review/concepts/concept-review-template.json" \
  --profile "$STRICT_DIR/data/profiles/$AUTHOR_SLUG/author-judgment-profile.json" \
  --review-id "${AUTHOR_HANDLE}_concept_review_001"
```

Acceptance:

- Command exits `0`.
- Profile contains `concepts`.
- Each accepted concept has aliases, linked domains, trigger conditions, boundary conditions, counterexamples, time scope, and evidence unit ids.
- No rejected concept is written into `profile.concepts`.
- Re-run strict validation or QA smoke tests when concept review materially changes answer routing.

## 8. Package Final Unit

Use the strict unit when available.

```sh
node scripts/ajm.js package-author \
  --profile "$STRICT_DIR/data/profiles/$AUTHOR_SLUG/author-judgment-profile.json" \
  --units "$STRICT_DIR/pruned-judgment-units.json" \
  --config "$CONFIG_PATH" \
  --out "$STRICT_DIR/package"
```

If no strict unit is needed and `$OUT_DIR/review/quality-gate.json` is already `pass`, package from `$OUT_DIR` instead:

```sh
node scripts/ajm.js package-author \
  --profile "$OUT_DIR/data/profiles/$AUTHOR_SLUG/author-judgment-profile.json" \
  --units "$OUT_DIR/data/judgment-units/$AUTHOR_SLUG/judgment-units.json" \
  --config "$CONFIG_PATH" \
  --out "$OUT_DIR/package"
```

Expected package files:

- `package/agent-prompt.md`
- `package/SKILL.md`
- `package/qa.md`
- `package/manifest.json`
- `package/data/author-judgment-profile.json`
- `package/data/judgment-units.json`
- `package/data/config.json`

Acceptance:

- Package manifest contains the expected `profile_id`.
- Package manifest lists `agent-prompt.md`, `SKILL.md`, and `qa.md`.
- Package data files all exist.
- Do not mix package files from `$OUT_DIR` and `$STRICT_DIR`.

## 9. QA Smoke Test

Covered-topic question:

```sh
node scripts/ajm.js answer \
  --profile "$STRICT_DIR/package/data/author-judgment-profile.json" \
  --units "$STRICT_DIR/package/data/judgment-units.json" \
  --config "$STRICT_DIR/package/data/config.json" \
  --question "现在买房主要看什么"
```

Unsupported-topic question:

```sh
node scripts/ajm.js answer \
  --profile "$STRICT_DIR/package/data/author-judgment-profile.json" \
  --units "$STRICT_DIR/package/data/judgment-units.json" \
  --config "$STRICT_DIR/package/data/config.json" \
  --question "今天午饭吃什么"
```

Acceptance:

- Covered question returns a non-null `likely_judgment_model`.
- Covered question includes non-empty `evidence_trace`.
- Covered question includes confidence and boundaries.
- Unsupported question returns `question_classification: "general"`.
- Unsupported question returns `likely_judgment_model: null`.
- Unsupported question returns `action_tendency: "refuse_or_downgrade_confidence"`.

## 10. Manual Review Loop

Use this loop when human review finds bad units or weak labels.

Fill:

```text
$OUT_DIR/review/manual-review-template.json
```

Correction rules:

- Domain review status `rejected` removes sampled units.
- Domain review status `needs_revision` keeps sampled units but marks them.
- Issue log with `item_type: "unit"` and `action: "reject"` removes exact unit.
- Issue log with `item_type: "unit"` and `action: "needs_revision"` marks exact unit.

Apply corrections:

```sh
node scripts/ajm.js apply-review-corrections \
  --review "$OUT_DIR/review/manual-review-template.json" \
  --posts "$OUT_DIR/data/normalized/$AUTHOR_SLUG/posts.json" \
  --units "$OUT_DIR/data/judgment-units/$AUTHOR_SLUG/judgment-units.json" \
  --out "$OUT_DIR-corrected" \
  --config "$CONFIG_PATH" \
  --author-id "$AUTHOR_ID" \
  --author-handle "$AUTHOR_HANDLE" \
  --review-id "${AUTHOR_HANDLE}_manual_review_001"
```

Expected outputs:

- `$OUT_DIR-corrected/corrected-judgment-units.json`
- `$OUT_DIR-corrected/correction-report.json`
- `$OUT_DIR-corrected/quality-gate.json`
- `$OUT_DIR-corrected/data/evidence-maps/$AUTHOR_SLUG/evidence-maps.json`
- `$OUT_DIR-corrected/data/profiles/$AUTHOR_SLUG/author-judgment-profile.json`

Acceptance:

- Rejected units are absent from corrected units.
- Revised units have `review_status: "needs_revision"`.
- Corrected profile contains `review_results`.
- Corrected quality gate has no blocking issues.

After correction:

- Rerun validation.
- Rerun quality gate.
- Prune again if needed.
- Repackage from the corrected or pruned-corrected directory.

## 11. Final Delivery

Final package directory:

```text
$STRICT_DIR/package
```

Deliverable files:

- `agent-prompt.md`
- `SKILL.md`
- `qa.md`
- `manifest.json`
- `data/author-judgment-profile.json`
- `data/judgment-units.json`
- `data/config.json`

Final acceptance:

- `npm test` passes.
- Final package exists.
- Final package manifest has the correct author id.
- Final quality gate is `pass`.
- Validation cases pass on final package data.
- Covered-topic smoke test passes.
- Unsupported-topic smoke test refuses or downgrades confidence.
- Agent, Skill, and QA entrypoints are present.

## 12. Required Invariants

- Do not imitate the author's voice or persona.
- Do not claim to represent the author personally.
- Do not infer unsupported real-time facts.
- Do not package a `fail` quality gate for serious use.
- Do not mix wide and strict package files.
- Do not treat generated baseline validation as a substitute for hand-written known-stance validation.
- Keep the raw source file unchanged during AJM processing.
