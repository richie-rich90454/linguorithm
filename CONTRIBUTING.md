# Contributing

Start with the [quickstart](docs/quickstart.md), [engineering specification](docs/engineering-specification.md), and [model card](docs/model-card.md). Application source uses the [MIT License](LICENSE); third-party data, models, and dependencies retain their own licenses.

## A focused change

Open an issue describing the problem, a minimal example, and desired behavior. A small correction can go directly into a focused pull request. Discuss substantial architecture, model, curriculum, or persistence changes before implementation. Separate unrelated changes.

Use synthetic examples instead of student writing or private documents. Keep essays and imported material local. Do not introduce analytics, remote fonts, network inference, or hidden external requests. Imported content must remain inert, and resource integrity failures must remain visible.

## Validation

```sh
make check
make content
make evaluate
make build
make bundle
```

Run `make browser` for UI, worker, model-loading, persistence, import, or accessibility changes. Run `make validate-models` when changing resources or packaging. Add meaningful regression tests for changed behavior. Explain checks you could not run. Preserve mandated `oxfmt.json` and identical `.oxfmtrc.json`; content validation checks consistency. Use `make format` when needed.

Generated reports must describe actual runs, including conditions and failures. Do not turn syntax metrics or synthetic calibration into claims about natural-essay precision or learning efficacy.

## Models and content

Preserve splits, provenance hashes, licenses, and complete notices. See [training](training/README.md) for reproduction. Do not contribute corpora you lack permission to share or ingest student writing without permission. Explain curriculum assumptions and answer ambiguity. Model promotion needs reviewed evidence; smaller weights alone are insufficient.

## Pull requests

Describe the user-visible problem, change, and verification. Include relevant screenshots for visual changes and reproduction steps for fixes. Call out migrations, new dependencies, limitations, and licensing implications. Follow the [code of conduct](CODE_OF_CONDUCT.md). Use the [security policy](SECURITY.md) for vulnerabilities.
