import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readDraft, writeDraft } from "@/src/lib/cloud/localDraft";

beforeEach(() => vi.stubGlobal("indexedDB", new IDBFactory()));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function legacyWrite(key: string, value: unknown) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open("lingdraw-ppt-local-drafts", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("drafts");
    open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error);
  });
  await new Promise<void>((resolve, reject) => { const tx = db.transaction("drafts", "readwrite"); tx.objectStore("drafts").put(value, key); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
  db.close();
}

describe("large local drafts", () => {
  it("does not submit repeated image strings in one oversized IndexedDB value", async () => {
    const originalPut = IDBObjectStore.prototype.put;
    const puts: unknown[] = [];
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, value, key) {
      puts.push(value);
      if (JSON.stringify(value).length > 1024 * 1024) throw new DOMException("The serialized keys and/or value are too large", "UnknownError");
      return originalPut.call(this, value, key);
    });
    const image = `data:image/png;base64,${Buffer.alloc(300_000, 42).toString("base64")}`;
    const input = { products: Array.from({ length: 10 }, () => ({ image, images: [image], rawData: { image } })) };
    await writeDraft("large", input);
    expect(await readDraft("large")).toEqual(input);
    expect(puts.every(value => JSON.stringify(value).length < 1024 * 1024)).toBe(true);
  });
  it("reads legacy drafts and never resurrects one after successful new-format deletion", async () => {
    await legacyWrite("draft", { text: "legacy" });
    expect(await readDraft("draft")).toEqual({ text: "legacy" });
    await writeDraft("draft", { text: "new" });
    expect(await readDraft("draft")).toEqual({ text: "new" });
    await writeDraft("draft", undefined);
    expect(await readDraft("draft")).toBeUndefined();
    await expect(readDraft("draft", true)).rejects.toThrow("已完成创建");
  });
  it("keeps the previous committed draft when a replacement transaction aborts", async () => {
    await writeDraft("draft", { text: "keep me" });
    const originalPut = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, value, key) {
      if (this.name === "parts") throw new DOMException("quota", "QuotaExceededError");
      return originalPut.call(this, value, key);
    });
    await expect(writeDraft("draft", { text: "new".repeat(100_000) })).rejects.toThrow();
    expect(await readDraft("draft")).toEqual({ text: "keep me" });
  });
  it("preserves all source files, binary data and edited text", async () => {
    const source = new File([new Uint8Array(9 * 1024 * 1024).fill(19)], "原始.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", lastModified: 1234 });
    const input = { files: [source], bytes: new Uint16Array([1, 256, 65535]), text: "编辑内容 🖼️", missing: undefined };
    await writeDraft("source", input);
    const restored = await readDraft<typeof input>("source");
    expect(restored?.files[0].name).toBe(source.name); expect(restored?.files[0].lastModified).toBe(1234);
    expect(restored?.files[0].size).toBe(source.size); expect(restored?.files[0].type).toBe(source.type);
    expect(Buffer.from(await restored!.files[0].arrayBuffer()).equals(Buffer.from(await source.arrayBuffer()))).toBe(true);
    expect(restored?.bytes).toEqual(input.bytes); expect(restored?.text).toBe(input.text); expect(restored).toHaveProperty("missing", undefined);
  });
  it("preserves live blob URLs as durable image data without recompressing", async () => {
    const bytes = new Uint8Array([1, 2, 3, 250]);
    const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
    try {
      await writeDraft("blob", { image: url, another: url });
      URL.revokeObjectURL(url);
      const restored = await readDraft<{ image: string; another: string }>("blob");
      expect(restored?.image).toBe(`data:image/png;base64,${Buffer.from(bytes).toString("base64")}`);
      expect(restored?.another).toBe(restored?.image);
    } finally { URL.revokeObjectURL(url); }
  });
  it("keeps separate drafts isolated across writes and deletion", async () => {
    await Promise.all([writeDraft("a", { image: "a".repeat(80_000) }), writeDraft("b", { image: "a".repeat(80_000) })]);
    await writeDraft("a", undefined);
    expect(await readDraft("b")).toEqual({ image: "a".repeat(80_000) });
  });
  it("deduplicates repeated image bytes and only rewrites metadata on the next checkpoint", async () => {
    const original = IDBObjectStore.prototype.put;
    const parts: { size: number; key: IDBValidKey | undefined }[] = [];
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, value, key) {
      if (this.name === "parts") parts.push({ size: value.size, key });
      return original.call(this, value, key);
    });
    const image = `data:image/png;base64,${Buffer.alloc(5 * 1024 * 1024, 7).toString("base64")}`;
    const draft = { image, copies: Array(20).fill(image), file: new File([new Uint8Array([1, 2])], "a.xlsx") };
    await writeDraft("dedup", draft);
    expect(parts.every(part => part.size <= 4 * 1024 * 1024)).toBe(true);
    expect(parts.reduce((sum, part) => sum + part.size, 0)).toBeLessThan(6 * 1024 * 1024);
    parts.length = 0; await writeDraft("dedup", { ...draft, edit: "change" });
    expect(parts.every(part => (part.key as string[])[1] === "metadata")).toBe(true);
  });
  it("serializes overlapping saves in invocation order and survives a failed save", async () => {
    await Promise.all([writeDraft("ordered", { v: 1 }), writeDraft("ordered", { v: 2 }), writeDraft("ordered", { v: 3 })]);
    expect(await readDraft("ordered")).toEqual({ v: 3 });
    await expect(writeDraft("ordered", { bad: new Map() })).rejects.toThrow();
    await writeDraft("ordered", { v: 4 }); expect(await readDraft("ordered")).toEqual({ v: 4 });
    const saving = writeDraft("ordered", { v: 5 });
    expect(await readDraft("ordered")).toEqual({ v: 5 }); await saving;
  });
  it("preserves shared references, cycles, special numbers and unicode", async () => {
    const item: Record<string, unknown> = { text: "\ud800".repeat(40_000), zero: -0, number: NaN };
    item.self = item;
    await writeDraft("graph", { a: item, b: item });
    const value = await readDraft<{ a: typeof item; b: typeof item }>("graph");
    expect(value!.a).toBe(value!.b); expect(value!.a.self).toBe(value!.a);
    expect(value!.a.text).toBe(item.text); expect(Object.is(value!.a.zero, -0)).toBe(true); expect(value!.a.number).toBeNaN();
  });
  it("chunks metadata as well as images when many distinct short fields are present", async () => {
    const input = { rows: Array.from({ length: 15_000 }, (_, index) => ({ text: `${index}:` + "x".repeat(350) })) };
    const original = IDBObjectStore.prototype.put; let metadataParts = 0;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, value, key) {
      if (this.name === "parts") { expect(value.size).toBeLessThanOrEqual(4 * 1024 * 1024); if ((key as string[])[1] === "metadata") metadataParts++; }
      return original.call(this, value, key);
    });
    await writeDraft("metadata", input);
    expect(metadataParts).toBeGreaterThan(1);
    expect(await readDraft("metadata")).toEqual(input);
  });
  it("rolls back already-written parts when a later part fails", async () => {
    await writeDraft("atomic", { old: "original" });
    const original = IDBObjectStore.prototype.put; let writes = 0;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, value, key) {
      if (this.name === "parts" && ++writes === 2) throw new DOMException("full", "QuotaExceededError");
      return original.call(this, value, key);
    });
    await expect(writeDraft("atomic", { file: new File([new Uint8Array(9 * 1024 * 1024)], "large.xlsx") })).rejects.toThrow();
    expect(await readDraft("atomic")).toEqual({ old: "original" });
  });
  it("leaves a legacy draft readable if the first new-format migration fails", async () => {
    await legacyWrite("migration", { old: "keep legacy" });
    const original = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, value, key) {
      if (this.name === "parts") throw new DOMException("quota", "QuotaExceededError");
      return original.call(this, value, key);
    });
    await expect(writeDraft("migration", { new: true })).rejects.toThrow();
    expect(await readDraft("migration")).toEqual({ old: "keep legacy" });
  });
});
