import { MAX_TEXT } from "../../../packages/engine/src/domain";
import { readBoundedZip } from "./archive-safety";

const all = (node: Document | Element, name: string): Element[] =>
    Array.from(node.getElementsByTagNameNS("*", name));
const first = (node: Document | Element, name: string) => all(node, name)[0];
const runs = (node: Element) =>
    all(node, "t")
        .map((text) => text.textContent ?? "")
        .join("");

/** Read text only. OOXML parts never enter the live DOM and formulas are never evaluated. */
export async function extractOfficeText(file: File): Promise<string> {
    const archive = await readBoundedZip(
        await file.arrayBuffer(),
        (name) => /\.(xml|rels)$/iu.test(name) || /vbaproject/iu.test(name),
    );
    const docs = new Map<string, Document>();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    for (const [name, bytes] of archive) {
        if (/vbaproject/iu.test(name))
            throw new Error("Macro-enabled Office files are not supported.");
        const source = decoder.decode(bytes);
        if (/<!DOCTYPE|<!ENTITY/iu.test(source))
            throw new Error("Office XML declarations and entities are not supported.");
        const doc = new DOMParser().parseFromString(source, "application/xml");
        if (all(doc, "parsererror").length || !doc.documentElement)
            throw new Error("Malformed Office XML.");
        if (name === "[Content_Types].xml" && /macroEnabled|vbaProject/iu.test(source))
            throw new Error("Macro-enabled Office files are not supported.");
        for (const rel of all(doc, "Relationship"))
            if (
                rel.getAttribute("TargetMode")?.toLowerCase() === "external" ||
                /^[a-z][a-z\d+.-]*:|^\/\//iu.test(rel.getAttribute("Target") ?? "")
            )
                throw new Error("External Office relationships are not supported.");
        docs.set(name, doc);
    }
    const required = (name: string) => {
        const doc = docs.get(name);
        if (!doc) throw new Error(`Missing Office part: ${name}`);
        return doc;
    };
    const related = (owner: string, id: string, kind: string): string => {
        const slash = owner.lastIndexOf("/");
        const rels = required(`${owner.slice(0, slash + 1)}_rels/${owner.slice(slash + 1)}.rels`);
        const matches = all(rels, "Relationship").filter((rel) => rel.getAttribute("Id") === id);
        const rel = matches[0];
        if (matches.length !== 1 || !rel?.getAttribute("Type")?.endsWith(`/${kind}`))
            throw new Error("Missing or invalid Office relationship.");
        const target = rel.getAttribute("Target") ?? "";
        if (!target || /[\\?#%]/u.test(target)) throw new Error("Invalid Office part path.");
        const parts = target.startsWith("/") ? [] : owner.slice(0, slash).split("/");
        for (const part of target.split("/")) {
            if (part === "..") {
                if (!parts.length) throw new Error("Invalid Office part path.");
                parts.pop();
            } else if (part && part !== ".") parts.push(part);
        }
        return parts.join("/");
    };
    let output = "";
    const append = (text: string) => {
        if (output.length + text.length > MAX_TEXT)
            throw new Error("Documents are limited to 150,000 characters.");
        output += text;
    };
    const relId = (el: Element) =>
        el.getAttributeNS(
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
            "id",
        ) ??
        el.getAttribute("r:id") ??
        "";
    if (file.name.toLowerCase().endsWith(".pptx")) {
        const owner = "ppt/presentation.xml";
        const slides = all(required(owner), "sldId");
        for (const [index, slide] of slides.entries()) {
            append(`# Slide ${index + 1}\n\n`);
            const doc = required(related(owner, relId(slide), "slide"));
            const tree = first(doc, "spTree");
            if (!tree) throw new Error("Malformed PowerPoint slide.");
            const walk = (node: Element) => {
                if (node.localName === "tbl") {
                    for (const row of all(node, "tr"))
                        append(
                            `| ${Array.from(row.children)
                                .filter((cell) => cell.localName === "tc")
                                .map((cell) => all(cell, "p").map(runs).join(" "))
                                .join(" | ")} |\n`,
                        );
                    append("\n");
                    return;
                }
                if (node.localName === "sp") {
                    const type = first(node, "ph")?.getAttribute("type");
                    for (const p of all(node, "p")) {
                        const text = runs(p);
                        if (!text) continue;
                        const props = first(p, "pPr");
                        const bullet =
                            props && (first(props, "buChar") || first(props, "buAutoNum"));
                        append(
                            `${type === "title" || type === "ctrTitle" ? "## " : bullet ? "- " : ""}${text}\n`,
                        );
                    }
                    append("\n");
                    return;
                }
                for (const child of node.children) walk(child);
            };
            walk(tree);
        }
    } else {
        const owner = "xl/workbook.xml";
        const workbook = required(owner);
        const sharedRel = docs.get("xl/_rels/workbook.xml.rels");
        const sharedId =
            sharedRel &&
            all(sharedRel, "Relationship")
                .find((rel) => rel.getAttribute("Type")?.endsWith("/sharedStrings"))
                ?.getAttribute("Id");
        const shared = sharedId
            ? all(required(related(owner, sharedId, "sharedStrings")), "si").map(runs)
            : [];
        for (const sheet of all(workbook, "sheet")) {
            append(`# Sheet: ${sheet.getAttribute("name") ?? "Untitled"}\n\n`);
            const doc = required(related(owner, relId(sheet), "worksheet"));
            let count = 0;
            const seen = new Set<string>();
            for (const row of all(doc, "row")) {
                for (const cell of Array.from(row.children).filter((el) => el.localName === "c")) {
                    const ref = cell.getAttribute("r") ?? "";
                    const match = /^([A-Z]{1,3})([1-9]\d{0,6})$/u.exec(ref);
                    let column = 0;
                    for (const letter of match?.[1] ?? "")
                        column = column * 26 + letter.charCodeAt(0) - 64;
                    if (
                        !match ||
                        column > 16384 ||
                        Number(match[2]) > 1048576 ||
                        seen.has(ref) ||
                        ++count > 100000
                    )
                        throw new Error("Invalid or oversized worksheet cell range.");
                    seen.add(ref);
                    const value = first(cell, "v")?.textContent;
                    const type = cell.getAttribute("t");
                    let text = value ?? "";
                    if (type === "s") {
                        if (
                            !value ||
                            !/^\d+$/u.test(value) ||
                            !Number.isSafeInteger(Number(value)) ||
                            Number(value) >= shared.length
                        )
                            throw new Error("Invalid shared string index.");
                        text = shared[Number(value)]!;
                    } else if (type === "inlineStr") text = runs(cell);
                    else if (type === "b") text = value === "1" ? "TRUE" : "FALSE";
                    if (first(cell, "f") && value === undefined)
                        text = "[Formula: cached value unavailable]";
                    if (text) append(`${ref}: ${text}\n`);
                }
            }
            append("\n");
        }
    }
    return output.trim();
}
