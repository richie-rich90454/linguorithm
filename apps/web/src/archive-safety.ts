/** Validate actual ZIP expansion before handing a DOCX archive to a document parser. */
export async function validateDocxArchive(buffer: ArrayBuffer): Promise<void> {
    const entries = await readBoundedZip(buffer, (name) => name === "word/document.xml");
    if (!entries.has("word/document.xml"))
        throw new Error("The archive does not contain a Word document.");
}

/** Every entry is expanded and checked, even when only selected contents are retained. */
export async function readBoundedZip(
    buffer: ArrayBuffer,
    include: (name: string) => boolean = () => true,
): Promise<Map<string, Uint8Array>> {
    const result = new Map<string, Uint8Array>();
    const names = new Set<string>();
    const bytes = new Uint8Array(buffer),
        view = new DataView(buffer);
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
        if (view.getUint32(i, true) === 0x06054b50) {
            end = i;
            break;
        }
    if (end < 0) throw new Error("This DOCX file is not a valid ZIP archive.");
    const entries = view.getUint16(end + 10, true),
        directory = view.getUint32(end + 16, true);
    if (
        entries === 65535 ||
        entries > 2000 ||
        directory >= bytes.length ||
        end + 22 + view.getUint16(end + 20, true) !== bytes.length ||
        directory + view.getUint32(end + 12, true) !== end ||
        view.getUint16(end + 4, true) !== 0 ||
        view.getUint16(end + 6, true) !== 0 ||
        view.getUint16(end + 8, true) !== entries
    )
        throw new Error("Unsupported or oversized DOCX archive.");
    let pointer = directory,
        expanded = 0;
    for (let i = 0; i < entries; i++) {
        if (pointer + 46 > bytes.length || view.getUint32(pointer, true) !== 0x02014b50)
            throw new Error("Malformed DOCX directory.");
        const method = view.getUint16(pointer + 10, true),
            compressed = view.getUint32(pointer + 20, true),
            expected = view.getUint32(pointer + 24, true),
            nameSize = view.getUint16(pointer + 28, true),
            extra = view.getUint16(pointer + 30, true),
            comment = view.getUint16(pointer + 32, true),
            offset = view.getUint32(pointer + 42, true);
        const name = new TextDecoder().decode(bytes.slice(pointer + 46, pointer + 46 + nameSize));
        if (
            pointer + 46 + nameSize + extra + comment > end ||
            names.has(name) ||
            name.includes("\\") ||
            Array.from(name).some((character) => character.charCodeAt(0) < 32) ||
            (view.getUint16(pointer + 8, true) & 1) !== 0
        )
            throw new Error("Malformed or encrypted ZIP entry.");
        names.add(name);
        if (
            name.includes("..") ||
            name.startsWith("/") ||
            expected > 30_000_000 ||
            expanded + expected > 30_000_000 ||
            offset + 30 > bytes.length ||
            view.getUint32(offset, true) !== 0x04034b50
        )
            throw new Error("DOCX archive exceeds extraction limits or has invalid entries.");
        const start =
            offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
        if (
            start + compressed > directory ||
            view.getUint16(offset + 8, true) !== method ||
            new TextDecoder().decode(
                bytes.slice(offset + 30, offset + 30 + view.getUint16(offset + 26, true)),
            ) !== name
        )
            throw new Error("Truncated DOCX entry.");
        const content = bytes.slice(start, start + compressed);
        const retain = include(name);
        const chunks: Uint8Array[] = [];
        let actual = 0,
            checksum = 0xffffffff;
        const check = (chunk: Uint8Array) => {
            for (const byte of chunk) {
                checksum ^= byte;
                for (let bit = 0; bit < 8; bit++)
                    checksum = (checksum >>> 1) ^ (checksum & 1 ? 0xedb88320 : 0);
            }
        };
        if (method === 0) {
            actual = content.length;
            check(content);
            if (retain) chunks.push(content);
        } else if (method === 8) {
            const reader = new Blob([content])
                .stream()
                .pipeThrough(new DecompressionStream("deflate-raw"))
                .getReader();
            try {
                while (true) {
                    const next = await reader.read();
                    if (next.done) break;
                    actual += next.value.byteLength;
                    if (actual + expanded > 30_000_000) {
                        await reader.cancel();
                        throw new Error("DOCX decompression exceeds 30 MB.");
                    }
                    check(next.value);
                    if (retain) chunks.push(next.value);
                }
            } finally {
                reader.releaseLock();
            }
        } else throw new Error("Unsupported DOCX compression method.");
        if (actual !== expected)
            throw new Error("DOCX decompression size does not match its directory.");
        if ((checksum ^ 0xffffffff) >>> 0 !== view.getUint32(pointer + 16, true))
            throw new Error("ZIP entry checksum does not match its directory.");
        expanded += actual;
        if (expanded > 30_000_000) throw new Error("DOCX decompression exceeds 30 MB.");
        if (retain) {
            const output = new Uint8Array(actual);
            let position = 0;
            for (const chunk of chunks) {
                output.set(chunk, position);
                position += chunk.length;
            }
            result.set(name, output);
        }
        pointer += 46 + nameSize + extra + comment;
    }
    if (pointer !== end) throw new Error("Malformed DOCX directory.");
    return result;
}
