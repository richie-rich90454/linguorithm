# Local development quickstart

Run commands from the repository root. GNU Make delegates execution to `scripts/task.mjs`, which launches processes using argument arrays and `shell: false`. The workflow does not require the legacy Windows command launcher. Root package scripts remain available for compatibility.

## Existing working copy

On Windows, Make uses `.tools/node/node.exe`. On macOS/Linux it prefers `.tools/node/bin/node`, then an already installed Node runtime. Override with `make NODE="/absolute/path/to/node" help` if needed. Windows users with a preinstalled runtime can use `make NODE=node help`. Native dependencies, virtual environments, runtimes, and browsers must be recreated when moving between platforms.

```sh
make help
make dev
```

The supplied local pnpm is `.tools/pnpm12/bin/pnpm.mjs`; the launcher also supports an npm-installed pnpm under `.tools/package-manager`. It never resolves a global pnpm executable. An existing working copy may already contain every prerequisite.

## Fresh clone

Git excludes runtimes, dependencies, caches, raw corpora, and generated training weights. Browser-ready models are shipped separately in the tracked `models/releases` archive: `make build` restores and verifies them automatically. No Python or training download is needed for ordinary frontend development.

1. Provide GNU Make and a compatible Node runtime. The current workflow pins Node 24.13.0. For runtime isolation, unpack an official Node distribution into `.tools/node` (`node.exe` on Windows; `bin/node` on POSIX), retaining bundled npm. A preinstalled runtime may instead be used read-only via `NODE=node`.
2. Install the pinned package manager and workspace dependencies explicitly:

    ```sh
    make install-pnpm
    make install
    ```

    With preinstalled Node on Windows, append `NODE=node` to these commands and subsequent targets. `install-pnpm` uses npm bundled with the selected Node runtime and writes pnpm 12.14.0 into `.tools/package-manager`. The supplied bare Windows `node.exe` does not include npm: if local pnpm is missing, supply a complete Node distribution first. No target installs global tooling.

3. Restore models for development, then verify and build:

    ```sh
    make models
    make check
    make content
    make validate-models
    make build
    make preview
    ```

4. For browser testing, install browsers explicitly and run the suite:

    ```sh
    make install-browsers
    make browser
    ```

    Browser binaries live in `.cache/ms-playwright`. Linux browser system libraries must already be supplied by the OS or container; this target does not install system packages.

## Python and model training

Frontend development consumes the bundled model release. Training is optional and needs a compatible local Python runtime, `.venv`, sufficient CPU/memory, and network access for pinned corpus acquisition. Read [training](../training/README.md) and the [model card](model-card.md) first.

If recreating the training environment, unpack Python into `.tools/python`, then create `.venv` with that runtime:

```powershell
# Windows
.tools/python/python.exe -m venv .venv
```

```sh
# macOS/Linux: adapt the executable name to the supplied distribution
.tools/python/bin/python3 -m venv .venv
```

An already installed compatible Python may instead create `.venv` without modifying its own installation. Then use the same targets on every platform:

```sh
make install-python
make train
make validate-models
make build
make browser
```

`make train` ingests EWT, fits syntax/error/ranker models, evaluates the baseline, packages browser assets, and evaluates quantization. It requires dictionary inputs described in the training guide. It can overwrite generated models and reports; review quality and notices before intentionally updating a release. It never publishes or promotes a remote release.

The normal build restores the pinned release. To test newly packaged candidate models, explicitly set `SYNTAX_MODEL_SOURCE=candidate` before `make build` (PowerShell: `$env:SYNTAX_MODEL_SOURCE = "candidate"`; POSIX: `SYNTAX_MODEL_SOURCE=candidate make build`). This validates candidate resources instead of restoring the release. Remove the environment override to return to the pinned release.

## Isolation and options

The launcher configures project-local pnpm/npm/pip caches, browser storage, Torch/Hugging Face caches, XDG directories, Windows application-data directories, and temporary directories. Python user-site packages are disabled. Normal targets report missing prerequisites instead of fetching them. Deleting ignored directories can remove the only local copy of tools or training data.

```sh
make dev ARGS="--port 5174"
make browser ARGS="--project=chromium"
make format
make benchmark
```

Use simple CLI arguments in `ARGS`; complex quoting depends on the invoking shell. You can bypass Make with `.tools/node/node.exe scripts/task.mjs browser --project=chromium` on Windows, or `.tools/node/bin/node scripts/task.mjs browser --project=chromium` on POSIX.

For inspection, first run `make build`, then `make preview` in one terminal. Run `make inspect`, `make benchmark-browser`, `make ablation`, or `make compare` in another. The browser test target starts its own production preview when needed.

## Troubleshooting

| Symptom | Next step |
| --- | --- |
| Missing local Node | Supply the platform's runtime or pass `NODE=node` |
| Missing package or pnpm | Run the corresponding explicit setup target |
| Missing or corrupt models | Run `make models`, then `make validate-models`; review integrity errors |
| Browser executable missing | Run `make install-browsers` for this OS |
| Preview unavailable | Build first, use port 4317, check whether another server owns it |
| Offline assets disappeared | Storage may have been evicted; reconnect to the local server and reload |

Never include student essays, local backups, or private documents in a bug report. See [support](../SUPPORT.md).
