import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineConfig } from "vitepress";

const base = (process.env.DOCS_BASE || "/").replace(/\/?$/u, "/");
const dirname = fileURLToPath(new URL(".", import.meta.url));
// "Open app" must be an absolute URL: VitePress prefixes site-absolute links
// with `base`, which would otherwise point back into the documentation.
const appUrl = process.env.APP_URL || "http://127.0.0.1:5173/";

export default defineConfig({
    base,
    outDir: resolve(dirname, "../../apps/web/dist/docs"),
    cleanUrls: false,
    lastUpdated: true,
    ignoreDeadLinks: true,
    appearance: false,
    title: "Linguorithm",
    description: "Local-first, non-generative grammar analysis and adaptive writing practice.",
    head: [
        ["link", { rel: "icon", type: "image/svg+xml", href: `${base}icon.svg` }],
        ["link", { rel: "shortcut icon", href: `${base}favicon.ico` }],
        ["meta", { name: "theme-color", content: "#ffffff" }],
    ],
    markdown: {
        lineNumbers: false,
        image: {
            lazyLoading: true,
        },
    },
    themeConfig: {
        logo: "/icon.svg",
        nav: [{ text: "Open app", link: appUrl, target: "_self" }],
        search: {
            provider: "local",
        },
        sidebar: [
            {
                text: "Start",
                items: [
                    { text: "Overview", link: "/" },
                    { text: "Quick start", link: "/quickstart" },
                    { text: "Writing progression", link: "/writing-progression" },
                ],
            },
            {
                text: "Evaluation",
                items: [
                    { text: "Benchmark", link: "/benchmark" },
                    { text: "Model card", link: "/model-card" },
                    { text: "Detector coverage", link: "/detector-coverage" },
                    { text: "Evaluation protocol", link: "/evaluation-protocol" },
                    { text: "Release status", link: "/release-status" },
                    { text: "Scorecard", link: "/scorecard" },
                    {
                        text: "Adjudication tool",
                        link: "https://github.com/richie-rich90454/linguorithm/tree/main/tools/annotate",
                    },
                ],
            },
            {
                text: "Trust",
                items: [
                    { text: "Language controls", link: "/language-controls" },
                    { text: "Privacy", link: "/privacy" },
                    { text: "Project containment", link: "/project-containment" },
                ],
            },
            {
                text: "Engineering",
                items: [
                    { text: "Engineering specification", link: "/engineering-specification" },
                    { text: "Research data models", link: "/research-data-models" },
                    {
                        text: "Dataset expansion research",
                        link: "/dataset-expansion-research-2026-10-25",
                    },
                    { text: "Release gates 2026-10-24", link: "/release-gates-2026-10-24" },
                    { text: "Design audit", link: "/design-audit" },
                    { text: "GitHub discovery", link: "/github-discovery" },
                ],
            },
        ],
    },
});
