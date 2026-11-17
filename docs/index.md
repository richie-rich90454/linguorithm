---
layout: home

hero:
    name: Linguorithm
    text: A local-first writing tutor that shows its evidence
    tagline: Non-generative analysis that runs on your device, marks the exact span behind every finding, abstains when it cannot prove a correction, and keeps the essay private.
    actions:
        - theme: brand
          text: Open the app
          link: https://richie-rich90454.github.io/linguorithm/
        - theme: alt
          text: Quick start
          link: /quickstart

features:
    - title: Local and offline
      details: Models, dictionary, and fonts ship with the app. Essays stay in the browser. There is no account, no upload, and no network call after first load.
    - title: Evidence on every finding
      details: Each diagnostic cites the source span, the rule or model path that produced it, and any accepted alternative. Corrections are bounded, typed edits you can inspect and undo.
    - title: Calibrated abstention
      details: Ambiguous evidence produces no claim. Confidence is shown only where calibration was measured, and uncertain construction families stay in review mode.
    - title: Learner loop
      details: A seven-skill prerequisite graph, Bayesian knowledge tracing, scheduled review, and practice mapped to the skill behind each finding.
    - title: Open benchmark
      details: The frozen baseline is published in full, including its failures. Benchmark v2 is being rebuilt with adjudicated labels, matched controls, writer-separated splits, and a sealed test.
    - title: Accessibility
      details: Keyboard-first navigation, semantic markup, visible focus, reduced-motion support, and narrow-screen layouts are part of the release contract.
---

## What is measured

The current build does not meet its accuracy gates. On the frozen 184-document learner-essay split it reports **15.69% precision** and **3.19% recall**, with a **1.211% false-positive rate** on unannotated tokens. Every count, interval, and known defect is published in the [benchmark](/benchmark), including the arithmetic reason the previous target could not have been met on that reference.

Treat the engine as a review aid, not an authority. The project will claim only what the sealed v2 benchmark and the valid-English control suite can demonstrate.

## Read next

- [Quick start](/quickstart) — build, run, and verify the workspace.
- [Language controls](/language-controls) — the zero-false-accusation promise and its control corpus.
- [Privacy](/privacy) — verifiable offline posture, storage, export, and erasure.
- [Model card](/model-card) — component metrics, scope limits, and release status.
