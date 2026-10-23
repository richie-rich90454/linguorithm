import { expect, it } from "vitest";
import { EssayDocument } from "../src";

it("keeps revision and history timestamps increasing after restoring a future-dated backup", () => {
    const original = EssayDocument.create("Students are ready.");
    const future = new EssayDocument({ ...original.record, updatedAt: "2099-01-01T00:00:00.000Z" });
    const edited = future.revise("Students were ready.", "Edit restored text");
    const undone = edited.undo(),
        redone = undone.redo();
    expect(Date.parse(edited.record.updatedAt)).toBeGreaterThan(
        Date.parse(future.record.updatedAt),
    );
    expect(Date.parse(undone.record.updatedAt)).toBeGreaterThan(
        Date.parse(edited.record.updatedAt),
    );
    expect(Date.parse(redone.record.updatedAt)).toBeGreaterThan(
        Date.parse(undone.record.updatedAt),
    );
    expect(redone.text).toBe(edited.text);
});
