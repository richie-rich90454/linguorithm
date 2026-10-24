# Changelog

Changes are recorded here before a tagged release is published.

## 0.2.0 — Unreleased

### Added

- Local trained syntax models, a contextual correction ranker, and a 121,191-form spelling dictionary.
- A versioned, integrity-checked model bundle that builds restore without network access or Python.
- Source-linked essay corrections, syntactic alternatives, adaptive practice, and assessment records.
- TXT, Markdown, HTML, DOCX, PPTX, XLSX, and text-based PDF imports with bounded extraction.
- MIT application licensing, contribution and security guides, community policies, and issue templates.
- GNU Make targets for development, setup, verification, and production builds on Windows, macOS, and Linux.

### Changed

- Refined the workspace around the essay, with larger reading text, compact navigation, and clearer findings.
- Kept analysis controls within laptop viewports and reduced repeated introductions in the workbench.
- Replaced the Windows CMD launcher with a shell-independent Node task runner behind Make.

### Fixed

- Model cache updates, integrity failures, and retries after transient initialization errors.
- Additive backup merging, timestamp comparisons, capacity validation, and stale document writes.
- Assessment navigation, pre-answer source disclosure, and the treatment of repeated attempts.

### Evaluation scope

Linguorithm and synthetic-task measurements are documented in the model card. Independent natural-essay accuracy, physical-device performance, and educational effectiveness have not been established. No comparative superiority claim is implied by this release.
