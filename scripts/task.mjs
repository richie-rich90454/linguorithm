import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join, resolve, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const win = process.platform === "win32";
const localNode = join(root, win ? ".tools/node/node.exe" : ".tools/node/bin/node");
const node = existsSync(localNode) ? localNode : process.execPath;
const env = { ...process.env };
const locations = {
    PLAYWRIGHT_BROWSERS_PATH: ".cache/ms-playwright",
    PNPM_HOME: ".tools/pnpm-home",
    PNPM_STORE_DIR: ".cache/pnpm-store",
    npm_config_cache: ".cache/npm",
    npm_config_prefix: ".tools/npm-prefix",
    npm_config_userconfig: ".cache/npm-userconfig",
    npm_config_globalconfig: ".cache/npm-globalconfig",
    PIP_CACHE_DIR: ".cache/pip",
    TORCH_HOME: ".cache/torch",
    HF_HOME: ".cache/huggingface",
    XDG_CACHE_HOME: ".cache/xdg",
    XDG_CONFIG_HOME: ".cache/config",
    XDG_DATA_HOME: ".cache/data",
    XDG_STATE_HOME: ".cache/state",
    LOCALAPPDATA: ".cache/local-appdata",
    APPDATA: ".cache/appdata",
    NUMBA_CACHE_DIR: ".cache/numba",
    RUFF_CACHE_DIR: ".cache/ruff",
    TEMP: ".cache/tmp",
    TMP: ".cache/tmp",
    TMPDIR: ".cache/tmp",
};
for (const [key, path] of Object.entries(locations)) env[key] = join(root, path);
env.PYTHONNOUSERSITE = "1";
env.PYTHONUTF8 = "1";
// Keep inherited executables available for OS utilities, never for resolving pnpm.
const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
env[pathKey] = [dirname(node), join(root, "node_modules/.bin"), env[pathKey] ?? ""].join(delimiter);

function bin(packageName, command) {
    let manifestPath;
    try {
        manifestPath = require.resolve(`${packageName}/package.json`);
    } catch {
        throw new Error(`Missing ${packageName}. Run make install explicitly first.`);
    }
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const entry = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.[command];
    if (!entry) throw new Error(`No ${command} executable in ${packageName}.`);
    return join(dirname(manifestPath), entry);
}

let child;
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
        stopping = true;
        if (child) child.kill(signal);
        else process.exit(signal === "SIGINT" ? 130 : 143);
    });
}
async function run(executable, args, cwd = root) {
    if (stopping) throw new Error("Task interrupted.");
    await new Promise((accept, reject) => {
        child = spawn(executable, args, { cwd, env, stdio: "inherit", shell: false });
        child.once("error", reject);
        child.once("exit", (code, signal) => {
            child = undefined;
            if (code === 0 && !stopping) accept();
            else {
                process.exitCode = code || (signal === "SIGINT" ? 130 : 143);
                reject(new Error(`Task exited ${signal ?? code}.`));
            }
        });
    });
}
const tool = (pkg, command, args = [], cwd = root) => run(node, [bin(pkg, command), ...args], cwd);
const script = (name, args = []) => run(node, [join(root, "scripts", name), ...args]);
function python() {
    const path = join(root, win ? ".venv/Scripts/python.exe" : ".venv/bin/python");
    if (!existsSync(path))
        throw new Error("Missing .venv. See docs/quickstart.md for local Python setup.");
    return path;
}
function pnpm() {
    const candidates = [
        ".tools/pnpm12/bin/pnpm.mjs",
        ".tools/package-manager/node_modules/pnpm/bin/pnpm.cjs",
        ".tools/package-manager/node_modules/pnpm/bin/pnpm.mjs",
    ];
    const path = candidates.map((part) => join(root, part)).find(existsSync);
    if (!path)
        throw new Error("Missing project-local pnpm. Run make install-pnpm explicitly first.");
    return path;
}
const extra = process.argv.slice(3);
const tasks = {
    help: () =>
        console.log(`Syntax development commands (make TARGET ARGS="...")
dev             Start local Vite development server
check           Lint, formatting, TypeScript, unit tests
build           Build production site in apps/web/dist
preview         Serve production site at 127.0.0.1:4317
test            Run engine unit tests
browser         Run Playwright suite (build first)
evaluate        Run deterministic engine evaluation
validate-models Verify packaged model resources
models          Restore bundled model release for development
content         Validate question bank and formatting configuration
bundle          Check production bundle budgets (build first)
benchmark       Run engine benchmark
inspect         Inspect UI (start make preview separately)
train           Retrain, evaluate and package models using .venv
lint format typecheck benchmark-browser ablation compare
Explicit network/setup commands: install-pnpm install install-browsers install-python
release         Run source, content, model-bundle, build, budget, and browser release checks
check-model-release  Verify a fresh model restore and corruption handling
No command installs prerequisites implicitly. See docs/quickstart.md.`),
    dev: async () => {
        await tasks.models();
        await tool("vite", "vite", ["--host", "127.0.0.1", ...extra], join(root, "apps/web"));
    },
    preview: () =>
        tool(
            "vite",
            "vite",
            ["preview", "--host", "127.0.0.1", "--port", "4317", ...extra],
            join(root, "apps/web"),
        ),
    lint: () => tool("oxlint", "oxlint", [".", ...extra]),
    format: () => tool("oxfmt", "oxfmt", [".", ...extra]),
    typecheck: async () => {
        for (const workspace of ["packages/engine", "apps/web"])
            await tool("typescript", "tsc", ["--noEmit", ...extra], join(root, workspace));
    },
    test: () => tool("vitest", "vitest", ["run", ...extra], join(root, "packages/engine")),
    check: async () => {
        await tasks.lint();
        await tool("oxfmt", "oxfmt", ["--check", "."]);
        await tasks.typecheck();
        await tasks.test();
    },
    models: () => script("restore-models.mjs", extra),
    build: async () => {
        await tasks.models();
        await tool("vite", "vite", ["build", ...extra], join(root, "apps/web"));
    },
    browser: () => tool("@playwright/test", "playwright", ["test", ...extra]),
    evaluate: () => tool("tsx", "tsx", ["scripts/evaluate.ts", ...extra]),
    content: () => tool("tsx", "tsx", ["scripts/validate-content.ts", ...extra]),
    "validate-models": () => script("validate-models.mjs", extra),
    "check-model-release": () => script("check-model-release.mjs"),
    release: async () => {
        await tasks.check();
        await tasks.content();
        await tasks["check-model-release"]();
        await tasks.build();
        await tasks["validate-models"]();
        await tasks.bundle();
        await tasks.browser();
    },
    bundle: () => script("check-bundle.mjs", extra),
    benchmark: () => tool("tsx", "tsx", ["scripts/benchmark.ts", ...extra]),
    inspect: () => script("inspect-ui.mjs", extra),
    "benchmark-browser": () => script("benchmark-browser.mjs", extra),
    ablation: () => tool("tsx", "tsx", ["scripts/ablate-browser.mts", ...extra]),
    compare: () => tool("tsx", "tsx", ["scripts/compare-systems.mts", ...extra]),
    install: () => run(node, [pnpm(), "install", "--frozen-lockfile", ...extra]),
    "install-pnpm": async () => {
        const candidates = [
            join(dirname(node), "node_modules/npm/bin/npm-cli.js"),
            join(dirname(node), "../lib/node_modules/npm/bin/npm-cli.js"),
        ];
        // npm from an already installed runtime is read-only; --prefix always stays in this checkout.
        try {
            candidates.push(require.resolve("npm/bin/npm-cli.js"));
        } catch {
            /* optional runtime bundle */
        }
        const npm = candidates.find(existsSync);
        if (!npm)
            throw new Error(
                "This Node runtime has no npm CLI. Supply a local Node distribution with npm (see docs/quickstart.md).",
            );
        await run(node, [
            npm,
            "install",
            "--prefix",
            join(root, ".tools/package-manager"),
            "--no-save",
            "--package-lock=false",
            "pnpm@12.14.0",
        ]);
    },
    "install-browsers": () =>
        tool("@playwright/test", "playwright", [
            "install",
            ...(extra.length ? extra : ["chromium", "firefox", "webkit"]),
        ]),
    "install-python": () =>
        run(python(), [
            "-m",
            "pip",
            "install",
            "--extra-index-url",
            "https://download.pytorch.org/whl/cpu",
            "-r",
            "training/requirements.lock.txt",
            ...extra,
        ]),
    train: async () => {
        for (const [name, ...args] of [
            ["ingest_ewt.py"],
            ["ingest_dictionary.py"],
            ["train_release.py", "--epochs", "12", "--parser-epochs", "6", ...extra],
            ["train_errors.py"],
            ["train_ranker.py"],
            ["evaluate_baseline.py"],
            ["package_models.py"],
            ["evaluate_quantization.py"],
        ])
            await run(python(), [join(root, "training", name), ...args]);
    },
};
try {
    const target = process.argv[2] ?? "help";
    if (!Object.hasOwn(tasks, target)) throw new Error(`Unknown task: ${target}. Run make help.`);
    if (target !== "help")
        for (const [key, path] of Object.entries(locations)) {
            mkdirSync(key.endsWith("config") ? dirname(join(root, path)) : join(root, path), {
                recursive: true,
            });
        }
    await tasks[target]();
} catch (error) {
    console.error(error.message);
    process.exitCode ||= 1;
}
