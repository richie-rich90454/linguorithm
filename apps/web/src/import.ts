import { MAX_TEXT } from "@grammar/engine";
import { validateDocxArchive } from "./archive-safety";
import { extractOfficeText } from "./office-import";

function htmlText(html: string): string {
    if (html.length > 2_000_000) throw new Error("HTML source is limited to 2 MB before parsing.");
    const template = document.createElement("template");
    template.innerHTML = html;
    const doc = template.content;
    doc.querySelectorAll(
        "script,style,iframe,object,embed,template,noscript,svg,math,img,link,base",
    ).forEach((el) => el.remove());
    doc.querySelectorAll("br").forEach((el) => el.replaceWith("\n"));
    const visit = (node: Node): string => {
        if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
        const el = node as Element;
        if (/^H[1-6]$/u.test(el.tagName ?? ""))
            return `\n\n${"#".repeat(Number(el.tagName[1]))} ${el.textContent}\n\n`;
        if (el.tagName === "TR")
            return "\n| " + [...el.children].map((cell) => cell.textContent).join(" | ") + " |\n";
        const text = [...node.childNodes].map(visit).join("");
        if (el.tagName === "LI") return `\n- ${text}\n`;
        return /^(P|DIV|SECTION|ARTICLE|HEADER|FOOTER|BLOCKQUOTE|UL|OL|TABLE)$/u.test(
            el.tagName ?? "",
        )
            ? `\n\n${text}\n\n`
            : text;
    };
    return visit(doc)
        .replace(/\n{3,}/gu, "\n\n")
        .trim();
}

export async function extractFile(file: File): Promise<string> {
    if (file.size > 15_000_000) throw new Error("Files must be smaller than 15 MB.");
    const extension = file.name.split(".").at(-1)?.toLowerCase();
    let text: string;
    if (["txt", "md", "markdown"].includes(extension ?? "")) text = await file.text();
    else if (["html", "htm"].includes(extension ?? "")) {
        // Template contents remain inert: scripts, images, links and frames are never activated.
        // A parsed Document may fetch subresources even while detached; a template does not.
        text = htmlText(await file.text());
    } else if (extension === "docx") {
        const mammoth = await import("mammoth/mammoth.browser");
        const arrayBuffer = await file.arrayBuffer();
        await validateDocxArchive(arrayBuffer);
        const result = await mammoth.convertToHtml({ arrayBuffer });
        text = htmlText(result.value);
    } else if (extension === "pptx" || extension === "xlsx") {
        text = await extractOfficeText(file);
    } else if (extension === "pdf") {
        const pdfjs = await import("pdfjs-dist");
        const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        const task = pdfjs.getDocument({
            data: new Uint8Array(await file.arrayBuffer()),
            useSystemFonts: true,
        });
        try {
            const pdf = await task.promise;
            if (pdf.numPages > 100) throw new Error("PDF imports are limited to 100 pages.");
            const pages: string[] = [];
            let total = 0;
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const content = await page.getTextContent();
                const extracted = content.items
                    .map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : " ") : ""))
                    .join("");
                total += extracted.length;
                if (total > MAX_TEXT) throw new Error("Extracted text exceeds 150,000 characters.");
                pages.push(`[Page ${i}]\n${extracted}`);
                page.cleanup();
            }
            text = pages.join("\n\n");
            if (!text.replace(/\[Page \d+\]/gu, "").trim())
                throw new Error(
                    "This PDF has no readable text. Scanned PDFs need OCR, which is not included.",
                );
        } finally {
            await task.destroy();
        }
    } else
        throw new Error(
            "Supported formats: TXT, Markdown, HTML, DOCX, PPTX, XLSX, and text-based PDF.",
        );
    if (text.length > MAX_TEXT) throw new Error("Extracted text exceeds 150,000 characters.");
    if (!text.trim()) throw new Error("No readable text was found.");
    return text;
}
