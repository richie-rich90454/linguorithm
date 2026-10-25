# Versioned training checkpoints

`ewt-1/` contains neural training checkpoints and a manifest with SHA-256 hashes, training data provenance, and held-out results. Checkpoints are kept in Git so model changes can be reviewed and compared across commits. Source corpora remain project-local in `.cache/` and `training/datasets/raw/`; only model parameters and compact metadata are stored here.

These are PyTorch artifacts produced by the training scripts. Load them only from a trusted Linguorithm checkout. The browser release continues to use the separately validated ONNX archive under `models/releases/`.
