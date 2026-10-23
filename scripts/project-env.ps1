# Dot-source this file before setup/training/browser tooling. It changes this process only.
$taskProjectRoot = Split-Path -Parent $PSScriptRoot
$env:PIP_CACHE_DIR = Join-Path $taskProjectRoot '.cache/pip'
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $taskProjectRoot '.cache/ms-playwright'
$env:TORCH_HOME = Join-Path $taskProjectRoot '.cache/torch'
$env:HF_HOME = Join-Path $taskProjectRoot '.cache/huggingface'
$env:XDG_CACHE_HOME = Join-Path $taskProjectRoot '.cache/xdg'
$env:XDG_CONFIG_HOME = Join-Path $taskProjectRoot '.cache/config'
$env:LOCALAPPDATA = Join-Path $taskProjectRoot '.cache/local-appdata'
$env:APPDATA = Join-Path $taskProjectRoot '.cache/appdata'
$env:NUMBA_CACHE_DIR = Join-Path $taskProjectRoot '.cache/numba'
$env:TEMP = Join-Path $taskProjectRoot '.cache/tmp'
$env:TMP = $env:TEMP
$env:PYTHONNOUSERSITE = '1'
$env:PNPM_HOME = Join-Path $taskProjectRoot '.tools/pnpm-home'
$env:npm_config_cache = Join-Path $taskProjectRoot '.cache/npm'
$env:PNPM_STORE_DIR = Join-Path $taskProjectRoot '.cache/pnpm-store'
$env:PATH = (Join-Path $taskProjectRoot '.tools/node') + ';' + (Join-Path $taskProjectRoot 'node_modules/.bin') + ';' + $env:PATH
New-Item -ItemType Directory -Force $env:PIP_CACHE_DIR,$env:PLAYWRIGHT_BROWSERS_PATH,$env:TEMP | Out-Null
