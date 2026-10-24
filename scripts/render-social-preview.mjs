import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(".cache/ms-playwright");
const publicDirectory = resolve("apps/web/public");
const iconSvg = readFileSync(resolve(publicDirectory, "icon.svg"), "utf8");
const socialSvg = readFileSync(resolve("docs/images/social-preview.svg"), "utf8");
const sizes = [16, 32, 48, 64, 180, 192, 512];
const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const size = Number(url.searchParams.get("size"));
    const image = url.pathname === "/icon.svg" ? iconSvg : socialSvg;
    const endpoint = url.pathname === "/icon.svg" || url.pathname === "/social-preview.svg";
    if (endpoint) {
        response.writeHead(200, {
            "content-type": "image/svg+xml; charset=utf-8",
            "cache-control": "no-store",
        });
        response.end(image);
        return;
    }
    if ((url.pathname === "/icon" && sizes.includes(size)) || url.pathname === "/social-preview") {
        const width = url.pathname === "/icon" ? size : 1280;
        const height = url.pathname === "/icon" ? size : 640;
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(
            `<!doctype html><meta charset="utf-8"><style>html,body{width:${width}px;height:${height}px;margin:0;overflow:hidden}img{display:block;width:${width}px;height:${height}px}</style><img id="artwork" src="${url.pathname === "/icon" ? "/icon.svg" : "/social-preview.svg"}" width="${width}" height="${height}" alt="">`,
        );
        return;
    }
    response.writeHead(404);
    response.end();
});

function makeBmpIcon(images) {
    const directory = Buffer.alloc(6 + images.length * 16);
    directory.writeUInt16LE(0, 0);
    directory.writeUInt16LE(1, 2);
    directory.writeUInt16LE(images.length, 4);
    const bitmaps = [];
    let offset = directory.length;
    for (const { size, rgba } of images) {
        const xorSize = size * size * 4;
        const maskStride = Math.ceil(size / 32) * 4;
        const maskSize = maskStride * size;
        const dib = Buffer.alloc(40 + xorSize + maskSize);
        dib.writeUInt32LE(40, 0);
        dib.writeInt32LE(size, 4);
        dib.writeInt32LE(size * 2, 8);
        dib.writeUInt16LE(1, 12);
        dib.writeUInt16LE(32, 14);
        dib.writeUInt32LE(0, 16);
        dib.writeUInt32LE(xorSize + maskSize, 20);
        for (let y = 0; y < size; y++) {
            const sourceY = size - y - 1;
            for (let x = 0; x < size; x++) {
                const source = (sourceY * size + x) * 4;
                const target = 40 + (y * size + x) * 4;
                dib[target] = rgba[source + 2];
                dib[target + 1] = rgba[source + 1];
                dib[target + 2] = rgba[source];
                dib[target + 3] = rgba[source + 3];
                if (rgba[source + 3] < 128)
                    dib[40 + xorSize + y * maskStride + (x >> 3)] |= 1 << (7 - (x & 7));
            }
        }
        const entry = 6 + bitmaps.length * 16;
        directory[entry] = size === 256 ? 0 : size;
        directory[entry + 1] = size === 256 ? 0 : size;
        directory.writeUInt16LE(1, entry + 4);
        directory.writeUInt16LE(32, entry + 6);
        directory.writeUInt32LE(dib.length, entry + 8);
        directory.writeUInt32LE(offset, entry + 12);
        bitmaps.push(dib);
        offset += dib.length;
    }
    return Buffer.concat([directory, ...bitmaps]);
}

await new Promise((accept, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", accept);
});
const address = server.address();
if (!address || typeof address === "string")
    throw new Error("Could not open the local artwork renderer.");
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch();
try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 640 } });
    const icoInputs = [];
    for (const size of sizes) {
        await page.setViewportSize({ width: size, height: size });
        await page.goto(`${origin}/icon?size=${size}`);
        const image = page.locator("#artwork");
        await image.evaluate((element) => element.decode());
        const filename =
            size === 180
                ? "apple-touch-icon.png"
                : size >= 192
                  ? `icon-${size}.png`
                  : `favicon-${size}.png`;
        await page.screenshot({
            path: resolve(publicDirectory, filename),
            omitBackground: true,
        });
        if (size <= 48) {
            const rgba = await page.evaluate(() => {
                const image = document.querySelector("#artwork");
                if (!(image instanceof HTMLImageElement)) throw new Error("Icon did not load.");
                const canvas = document.createElement("canvas");
                canvas.width = canvas.height = image.width;
                const context = canvas.getContext("2d", { willReadFrequently: true });
                if (!context) throw new Error("Canvas is unavailable for the ICO fallback.");
                context.drawImage(image, 0, 0, image.width, image.height);
                return [...context.getImageData(0, 0, image.width, image.height).data];
            });
            icoInputs.push({ size, rgba: Buffer.from(rgba) });
        }
    }
    writeFileSync(resolve(publicDirectory, "favicon.ico"), makeBmpIcon(icoInputs));
    await page.setViewportSize({ width: 1280, height: 640 });
    await page.goto(`${origin}/social-preview`);
    await page.locator("#artwork").evaluate((element) => element.decode());
    await page.screenshot({
        path: resolve("docs/images/social-preview.png"),
        omitBackground: true,
    });
} finally {
    await browser.close();
    await new Promise((accept, reject) =>
        server.close((error) => (error ? reject(error) : accept(undefined))),
    );
}
console.log("Rendered the SVG social preview and all Linguorithm icon fallbacks.");
