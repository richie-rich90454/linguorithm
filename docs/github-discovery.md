# GitHub discovery and presentation

This is a maintainer checklist for presenting Linguorithm accurately when the repository is published. Repository files cannot configure the GitHub About panel, topics, social preview, or feature settings. No Git remote is configured in this working copy, so this guide deliberately avoids guessed repository, deployment, and contact URLs.

## Suggested About description

English grammar checker, sentence analyzer, and adaptive practice workspace. Local-first browser inference with SolidJS and TypeScript; no accounts or essay uploads.

Use a working public deployment as the website only after it is deployed and verified. Until then, leave the website field empty. The README quickstart is the supported route into the application.

## Suggested topics

Select topics that describe implemented behavior:

```text
english-grammar grammar-checker sentence-analysis dependency-parsing
part-of-speech-tagging natural-language-processing adaptive-learning
local-first offline-first privacy solidjs typescript onnx-runtime
```

Review the topics against the current implementation before applying them. Avoid competitor names, unrelated popular technologies, or educational outcome claims as discovery keywords.

## Presentation checklist

- Keep the README screenshot current and show an invented essay with visible findings. Its alternative text should explain the workflow.
- Upload the prepared [social preview PNG](images/social-preview.png). The [editable SVG source](images/social-preview.svg) embeds the project's Noto Sans font and illustrates a source-linked agreement example. Run `make social-preview` after editing the SVG to regenerate the 1280 × 640 PNG. The font retains its [SIL Open Font License](../apps/web/public/Noto-Sans-OFL.txt).
- Enable Issues if accepting public feedback; the repository includes bug, feature, and grammar feedback forms. Keep Pull requests available for contributions.
- Configure private vulnerability reporting and a real confidential contact route before inviting sensitive reports. Update the security policy and code of conduct with verified contact details.
- Add a CI badge only after the real repository URL and default branch are known and the linked workflow has run successfully. Avoid placeholder badges.
- Publish releases only from verified builds. Link the model card and resource notices from release notes, and distinguish measured syntax results from unmeasured learning outcomes.
- Add `good first issue` or `help wanted` labels only to reviewed issues with clear reproduction or acceptance criteria. Do not label speculative work as contributor-ready.
- Keep the description, screenshot, README, and release notes aligned as the product changes.

## Upload the social preview

The PNG is 1280 × 640 with an opaque white background and is below GitHub's 1 MB limit. The SVG is the editable source; upload the PNG to GitHub.

1. Open the published repository on GitHub using an account with permission to edit repository settings.
2. Open **Settings**. If the tab is hidden, open the repository tab dropdown and select **Settings**.
3. Find **Social preview**, select **Edit**, then **Upload an image…**.
4. Choose `docs/images/social-preview.png` from this checkout and check the displayed preview.

See [GitHub's social preview instructions](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview) for upload requirements. Committing the asset alone does not activate it in repository settings.

## Sharing the project

Describe a concrete workflow: a source-linked correction, an inspectable dependency analysis, or a practice exercise. Link directly to the repository or a verified deployment. Explain browser-local processing and point to the model card for limitations. Prefer useful demonstrations and reproducible examples over repeated promotional posts. A star request belongs after readers can understand and try the project.

Discovery depends on an accessible public repository and useful contributions over time. This checklist improves presentation; it does not guarantee search placement, traffic, or stars.
