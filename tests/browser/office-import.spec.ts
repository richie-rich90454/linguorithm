import { test, expect, type Page } from "@playwright/test";
import { crc32, deflateRawSync } from "node:zlib";
import { readFile } from "node:fs/promises";

test.use({ serviceWorkers: "block" });

function zip(parts: Record<string, string>): Buffer {
    const locals: Buffer[] = [],
        central: Buffer[] = [];
    let offset = 0;
    for (const [path, xml] of Object.entries(parts)) {
        const name = Buffer.from(path),
            raw = Buffer.from(xml),
            data = deflateRawSync(raw);
        const local = Buffer.alloc(30),
            directory = Buffer.alloc(46);
        local.writeUInt32LE(0x04034b50);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(8, 8);
        local.writeUInt32LE(crc32(raw), 14);
        local.writeUInt32LE(data.length, 18);
        local.writeUInt32LE(raw.length, 22);
        local.writeUInt16LE(name.length, 26);
        directory.writeUInt32LE(0x02014b50);
        directory.writeUInt16LE(20, 4);
        directory.writeUInt16LE(20, 6);
        directory.writeUInt16LE(8, 10);
        directory.writeUInt32LE(crc32(raw), 16);
        directory.writeUInt32LE(data.length, 20);
        directory.writeUInt32LE(raw.length, 24);
        directory.writeUInt16LE(name.length, 28);
        directory.writeUInt32LE(offset, 42);
        locals.push(local, name, data);
        central.push(directory, name);
        offset += local.length + name.length + data.length;
    }
    const table = Buffer.concat(central),
        end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50);
    end.writeUInt16LE(Object.keys(parts).length, 8);
    end.writeUInt16LE(Object.keys(parts).length, 10);
    end.writeUInt32LE(table.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, table, end]);
}
const ns = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const relationships = (items: string) =>
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items}</Relationships>`;
const rel = (id: string, kind: string, target: string) =>
    `<Relationship Id="${id}" Type="${ns}/${kind}" Target="${target}"/>`;
const workbook = (): Record<string, string> => ({
    "xl/workbook.xml": `<workbook xmlns:r="${ns}"><sheets><sheet name="Grammar &amp; notes" r:id="two"/><sheet name="First" r:id="one"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": relationships(
        rel("one", "worksheet", "worksheets/sheet1.xml") +
            rel("two", "worksheet", "worksheets/sheet2.xml") +
            rel("strings", "sharedStrings", "sharedStrings.xml"),
    ),
    "xl/sharedStrings.xml": "<sst><si><r><t>Café </t></r><r><t>😀</t></r></si></sst>",
    "xl/worksheets/sheet1.xml":
        "<worksheet><sheetData><row r='1'><c r='A1' t='inlineStr'><is><t>Later sheet</t></is></c></row></sheetData></worksheet>",
    "xl/worksheets/sheet2.xml":
        "<worksheet><sheetData><row r='1'><c r='A1' t='s'><v>0</v></c><c r='C1'><v>42</v></c><c r='XFD1048576'><f>HYPERLINK(&quot;https://import-leak.test&quot;)</f><v>7</v></c><c r='D1'><f>1+1</f></c></row></sheetData></worksheet>",
});
async function upload(page: Page, name: string, parts: Record<string, string>) {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Apply correction" })).toBeVisible();
    await page
        .locator('input[type="file"]')
        .first()
        .setInputFiles({ name, mimeType: "application/zip", buffer: zip(parts) });
}
async function exported(page: Page) {
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export text" }).click();
    return readFile((await (await download).path())!, "utf8");
}

test("imports sparse spreadsheet cells and cached formulas in workbook sheet order", async ({
    page,
}) => {
    const leaks: string[] = [];
    page.on("request", (request) => {
        if (request.url().includes("import-leak")) leaks.push(request.url());
    });
    await upload(page, "notes.xlsx", workbook());
    await expect(page.getByLabel("Essay title")).toHaveValue("notes");
    const text = await exported(page);
    expect(text).toContain(
        "# Sheet: Grammar & notes\n\nA1: Café 😀\nC1: 42\nXFD1048576: 7\nD1: [Formula: cached value unavailable]",
    );
    expect(text.indexOf("Grammar & notes")).toBeLessThan(text.indexOf("# Sheet: First"));
    expect(text).not.toContain("HYPERLINK");
    expect(leaks).toEqual([]);
});

test("imports slide relationship order with headings, bullets, tables and slide numbers", async ({
    page,
}) => {
    const parts = {
        "ppt/presentation.xml": `<presentation xmlns:r="${ns}"><sldIdLst><sldId r:id="second"/><sldId r:id="first"/></sldIdLst></presentation>`,
        "ppt/_rels/presentation.xml.rels": relationships(
            rel("first", "slide", "slides/slide1.xml") +
                rel("second", "slide", "slides/slide2.xml"),
        ),
        "ppt/slides/slide1.xml": "<sld><spTree><sp><p><t>Final slide.</t></p></sp></spTree></sld>",
        "ppt/slides/slide2.xml":
            "<sld><spTree><sp><ph type='title'/><p><t>Grammar &amp; style</t></p></sp><sp><p><pPr><buChar char='•'/></pPr><t>A clear sentence.</t></p></sp><graphicFrame><tbl><tr><tc><p><t>Noun</t></p></tc><tc><p><t>Verb</t></p></tc></tr></tbl></graphicFrame></spTree></sld>",
    };
    await upload(page, "slides.pptx", parts);
    await expect(page.getByLabel("Essay title")).toHaveValue("slides");
    const text = await exported(page);
    expect(text).toContain("# Slide 1\n\n## Grammar & style");
    expect(text).toContain("- A clear sentence.");
    expect(text).toContain("| Noun | Verb |");
    expect(text).toContain("# Slide 2\n\nFinal slide.");
});

for (const attack of [
    "doctype",
    "external",
    "malformed",
    "macro",
    "range",
    "shared-index",
] as const)
    test(`rejects unsafe Office ${attack} without replacing the essay`, async ({ page }) => {
        const parts = workbook();
        if (attack === "doctype")
            parts["xl/sharedStrings.xml"] =
                '<!DOCTYPE sst [<!ENTITY attack SYSTEM "https://import-leak.test">]><sst><si><t>&attack;</t></si></sst>';
        if (attack === "external")
            parts["xl/_rels/workbook.xml.rels"] = relationships(
                '<Relationship Id="evil" TargetMode="External" Target="https://import-leak.test"/>',
            );
        if (attack === "malformed") parts["xl/sharedStrings.xml"] = "<sst><si>";
        if (attack === "macro")
            parts["[Content_Types].xml"] =
                '<Types><Override ContentType="application/vnd.ms-excel.sheet.macroEnabled.main+xml"/></Types>';
        if (attack === "range")
            parts["xl/worksheets/sheet2.xml"] =
                '<worksheet><row><c r="XFE1"><v>2</v></c></row></worksheet>';
        if (attack === "shared-index") parts["xl/sharedStrings.xml"] = "<sst/>";
        await page.goto("/");
        await expect(page.getByRole("button", { name: "Apply correction" })).toBeVisible();
        const before = await page.getByLabel("Annotated essay").innerText();
        await page
            .locator('input[type="file"]')
            .first()
            .setInputFiles({
                name: "hostile.xlsx",
                mimeType: "application/zip",
                buffer: zip(parts),
            });
        await expect(page.getByRole("alert")).toBeVisible();
        await expect(page.getByLabel("Annotated essay")).toHaveText(before);
    });
