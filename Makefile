# Recipes only launch Node: task orchestration never depends on cmd.exe or Bash.
ifeq ($(OS),Windows_NT)
NODE ?= $(if $(wildcard .tools/node/node.exe),.tools/node/node.exe,node)
else
NODE ?= $(if $(wildcard .tools/node/bin/node),.tools/node/bin/node,node)
endif

.DEFAULT_GOAL := help
.PHONY: release check-model-release
release check-model-release:
	"$(NODE)" scripts/task.mjs $@ $(ARGS)
.PHONY: help dev check build preview test browser evaluate validate-models content bundle benchmark inspect train lint format typecheck install-pnpm install install-browsers install-python benchmark-browser ablation compare models

help dev check build preview test browser evaluate validate-models content bundle benchmark inspect train lint format typecheck install-pnpm install install-browsers install-python benchmark-browser ablation compare models:
	"$(NODE)" scripts/task.mjs $@ $(ARGS)
