# Recipes only launch Node: task orchestration never depends on cmd.exe or Bash.
ifeq ($(OS),Windows_NT)
NODE ?= $(if $(wildcard .tools/node/node.exe),.tools/node/node.exe,node)
else
NODE ?= $(if $(wildcard .tools/node/bin/node),.tools/node/bin/node,node)
endif

.DEFAULT_GOAL := help
.PHONY: release check-model-release generalization prepare-errors check-classifier-features train-errors test-training train-ranker evaluate-baseline evaluate-parser-beam package-models package-release-models evaluate-quantization
release check-model-release generalization prepare-errors check-classifier-features train-errors test-training train-ranker evaluate-baseline evaluate-parser-beam package-models package-release-models evaluate-quantization:
	"$(NODE)" scripts/task.mjs $@ $(ARGS)
.PHONY: help dev check build preview test browser evaluate validate-models content bundle benchmark inspect train lint format typecheck install-pnpm install install-browsers install-python benchmark-browser ablation compare models social-preview

help dev check build preview test browser evaluate validate-models content bundle benchmark inspect train lint format typecheck install-pnpm install install-browsers install-python benchmark-browser ablation compare models social-preview:
	"$(NODE)" scripts/task.mjs $@ $(ARGS)
