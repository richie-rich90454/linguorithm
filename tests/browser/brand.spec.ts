import { expect, test } from "@playwright/test";

test("Linguorithm icons render in SVG, PNG, ICO, and install contexts", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
        const names = [
            "icon.svg",
            "favicon-16.png",
            "favicon-32.png",
            "favicon-48.png",
            "favicon-64.png",
            "apple-touch-icon.png",
            "icon-192.png",
            "icon-512.png",
        ];
        const images = await Promise.all(
            names.map(async (name) => {
                const image = new Image();
                image.src = new URL(name, location.href).href;
                await image.decode();
                return { name, width: image.naturalWidth, height: image.naturalHeight };
            }),
        );
        const icoResponse = await fetch(new URL("favicon.ico", location.href));
        const ico = await icoResponse.arrayBuffer();
        const view = new DataView(ico);
        const entries = Array.from({ length: view.getUint16(4, true) }, (_, index) => {
            const entry = 6 + index * 16;
            const offset = view.getUint32(entry + 12, true);
            return {
                width: new Uint8Array(ico)[entry] || 256,
                height: new Uint8Array(ico)[entry + 1] || 256,
                bitDepth: view.getUint16(entry + 6, true),
                size: view.getUint32(entry + 8, true),
                offset,
                dibHeaderSize: view.getUint32(offset, true),
            };
        });
        const manifest = await (await fetch(new URL("manifest.webmanifest", location.href))).json();
        const links = [...document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')].map(
            (link) => link.href,
        );
        const touchIcon = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
        return {
            title: document.title,
            images,
            icoValid:
                icoResponse.ok &&
                view.getUint16(0, true) === 0 &&
                view.getUint16(2, true) === 1 &&
                entries.length === 3 &&
                entries.every((entry) => entry.bitDepth === 32 && entry.dibHeaderSize === 40),
            icoDimensions: entries.map(({ width, height }) => [width, height]),
            links,
            touchIcon: touchIcon?.href,
            manifestIcons: manifest.icons.map((icon: { src: string; sizes: string }) => ({
                src: icon.src,
                sizes: icon.sizes,
            })),
        };
    });
    expect(result.title).toContain("Linguorithm");
    expect(result.images).toEqual([
        { name: "icon.svg", width: 512, height: 512 },
        { name: "favicon-16.png", width: 16, height: 16 },
        { name: "favicon-32.png", width: 32, height: 32 },
        { name: "favicon-48.png", width: 48, height: 48 },
        { name: "favicon-64.png", width: 64, height: 64 },
        { name: "apple-touch-icon.png", width: 180, height: 180 },
        { name: "icon-192.png", width: 192, height: 192 },
        { name: "icon-512.png", width: 512, height: 512 },
    ]);
    expect(result.icoValid).toBe(true);
    expect(result.icoDimensions).toEqual([
        [16, 16],
        [32, 32],
        [48, 48],
    ]);
    expect(result.links.some((href) => new URL(href).pathname.endsWith("/icon.svg"))).toBe(true);
    expect(result.links.some((href) => new URL(href).pathname.endsWith("/favicon.ico"))).toBe(true);
    expect(result.touchIcon).toContain("apple-touch-icon.png");
    expect(result.manifestIcons).toEqual(
        expect.arrayContaining([
            { src: "icon.svg", sizes: "any" },
            { src: "icon-192.png", sizes: "192x192" },
            { src: "icon-512.png", sizes: "512x512" },
        ]),
    );
});
