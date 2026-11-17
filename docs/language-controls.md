# Language controls

## The zero-false-accusation promise

A false accusation is worse than a missed correction. Flagging valid English teaches the learner something false, so a valid-control false positive is treated as a product defect, not as an acceptable cost of higher recall.

The engine abstains when the evidence is ambiguous. No finding, no rewrite, and no confidence number appear unless the construction is covered, the source span is stable, and the proposed edit preserves the writer's meaning. Patterns that cannot meet that bar are disabled or kept in review-only mode.

## Control categories

The control corpus contains valid English that naive detectors routinely flag. Each category is checked separately, because a low aggregate rate can hide a category that fails completely.

| Category | What it covers | Example failure the control catches |
| --- | --- | --- |
| Dialects | African American English, British and Commonwealth English, and Indian English | Spelling, preposition, and agreement differences treated as errors |
| Registers | Academic, business, conversational, and informal writing, including valid fragments and contractions | Formal-only rules applied to dialogue or notes |
| Genres | Essays, email, fiction, technical documentation, journalism, forum posts, and notes | Prose rules applied to headings, lists, or code-adjacent text |
| Punctuation style | Serial comma, dash style, quotation style, list-final punctuation, and accepted variants | One house style enforced as the only correct form |
| Usage variants | Split infinitives, stranded prepositions, singular _they_, passive voice, and other contested constructions | Style preferences emitted as grammatical errors |

Controls are matched where possible on dialect, register, genre, and length, so a pattern cannot pass by only seeing easy cases.

## Current status

The frozen suite contains **107 cases**. All 107 produce **no confirmed error**, and dialect cases produce **no likely grammar error**.

Two AAVE patterns — leveled past _be_ (_they was_) and negative concord (_she don't need no help_) — remain visible only as opt-in **possible issues**. They are grammatical in AAVE and indistinguishable from a learner agreement error without writer context, so the default review surface stays silent and the observation is never presented as a correction.

The suite is conservative by construction: it contains only cases where the expected answer is not contested. When a case cannot be fixed safely, it is removed and recorded rather than exempted inside the detector.

## Run the controls

```sh
make controls
make verify-offline
```

`make controls` checks the frozen valid-English control corpus and writes [`reports/language-controls.json`](https://github.com/richie-rich90454/linguorithm/blob/main/reports/language-controls.json). The report lists every flag by category, so a new false positive is attributable to a pattern rather than buried in an aggregate.

`make verify-offline` builds the production app, loads it in a real browser, records every request, and reloads with the network disabled. It writes [`reports/offline-verification.json`](https://github.com/richie-rich90454/linguorithm/blob/main/reports/offline-verification.json).

Both targets delegate to `scripts/task.mjs`. A checkout without GNU Make can run the same checks directly:

```sh
node scripts/task.mjs controls
node scripts/task.mjs verify-offline
```

## How the result is used

Any valid-control false positive blocks promotion of the pattern that produced it. The fix is either a narrower rule with explicit abstention or removal from the diagnostic set; tuning a threshold until the aggregate passes is not accepted. The [benchmark](/benchmark) records the separate accuracy gates, and the [model card](/model-card) records which patterns are active, review-only, or disabled.
