# Annotation workspace

Local-only adjudication tool for the RealEC candidate pool. It is static files with no build step, no dependencies, and no network access.

## Build the pool

```powershell
pnpm exec tsx scripts/build-annotation-pool.mts --self-test
```

The command writes `.cache/datasets/realec/v2/pool.json`. Use `--self-test` to check unique ids, forbidden label fields, span bounds, counts, and deterministic output.

## Open the tool

```powershell
start .\tools\annotate\index.html
```

On macOS use `open tools/annotate/index.html`; on Linux use `xdg-open tools/annotate/index.html`. No server is required because the pool is loaded with a file input, not `fetch`.

## Workflow

1. One person builds the pool and shares `pool.json`.
2. Annotator A opens the tool, enters a name, and labels every item independently. Keys: `1` error, `2` not an error, `3` different correction, `4` valid dialect/register, `0` skip, arrows navigate, `Ctrl/Cmd+Z` undo, `S` save. Progress autosaves in `localStorage` under `linguorithm:annotations:<poolFormat>`. Export `annotations-<name>.json` when finished.
3. Annotator B repeats the pass in a separate browser profile or machine, without seeing A's export. Do not share decisions before both passes are complete.
4. The adjudicator compares the two exports by `id`. Items with matching labels are accepted; disagreements are reviewed against the pool sentence, grammar evidence, and register context. Record the final decision in the project's adjudicated file.
5. Keep exports together, for example beside the pool: `.cache/datasets/realec/v2/annotations-<name>.json`.

The pool contains engine findings plus unlabeled controls and probes. It contains no gold labels and no annotation spans copied from the corpus; controls were only filtered against annotation ranges so they do not overlap annotated text.
