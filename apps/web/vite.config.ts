import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
    base: process.env.BASE_URL || "./",
    plugins: [
        {
            name: "local-only-csp",
            apply: "build",
            transformIndexHtml: () => [
                {
                    tag: "meta",
                    attrs: {
                        "http-equiv": "Content-Security-Policy",
                        content:
                            "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'none'",
                    },
                    injectTo: "head-prepend",
                },
            ],
        },
        solid(),
        VitePWA({
            registerType: "autoUpdate",
            manifest: {
                name: "Linguorithm — Grammar intelligence",
                short_name: "Linguorithm",
                theme_color: "#ffffff",
                background_color: "#ffffff",
                display: "standalone",
                icons: [
                    { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
                    { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
                    { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
                ],
            },
            workbox: {
                globPatterns: ["**/*.{js,mjs,css,html,svg,png,ico,woff2}"],
                maximumFileSizeToCacheInBytes: 5000000,
                navigateFallback: "index.html",
                runtimeCaching: [
                    {
                        urlPattern: ({ url }) =>
                            url.origin === self.location.origin &&
                            url.pathname.includes("/models/") &&
                            /^[a-f0-9]{64}$/u.test(url.searchParams.get("sha256") ?? ""),
                        // LocalSyntaxRuntime caches these only after SHA-256 verification.
                        handler: "NetworkOnly",
                    },
                    {
                        urlPattern: ({ url }) =>
                            url.origin === self.location.origin &&
                            (url.pathname.includes("/models/") || url.pathname.endsWith(".wasm")),
                        handler: "NetworkFirst",
                        options: {
                            cacheName: "syntax-model-discovery-v2",
                            networkTimeoutSeconds: 5,
                            expiration: { maxEntries: 32, maxAgeSeconds: 31536000 },
                            cacheableResponse: { statuses: [200] },
                        },
                    },
                ],
            },
        }),
    ],
    build: { target: "es2022", sourcemap: true, manifest: true },
    worker: { format: "es" },
});
