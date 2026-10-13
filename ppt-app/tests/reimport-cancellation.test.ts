import { beforeEach, describe, expect, it, vi } from "vitest";
import { catalogMeta } from "@/data/catalog";
import { mockProducts } from "@/data/mock-products";
import { emptyEditorState } from "@/types/editor";

const mocks = vi.hoisted(() => ({ parse: vi.fn() }));
vi.mock("@/src/lib/import/excel/parser", () => ({ parseExcelDocument: mocks.parse }));
import { useProjectStore } from "@/src/store/projectStore";

beforeEach(() => { vi.resetAllMocks(); useProjectStore.getState().resetImport(); });

describe("cancelled import isolation", () => {
  it("ignores a parser result that arrives after returning to the original project", async () => {
    let finish!: (value: unknown) => void;
    mocks.parse.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const pending = useProjectStore.getState().startDocumentImport(new File(["fake"], "new.xlsx"));
    await vi.waitFor(() => expect(mocks.parse).toHaveBeenCalled());
    const original = { project: catalogMeta, products: mockProducts.slice(0, 2), layoutOverrides: {}, editorState: emptyEditorState() };
    useProjectStore.getState().cancelDocumentImport();
    useProjectStore.getState().loadEditorSnapshot(original);
    // Deliberately malformed result would fail if the cancelled parser were applied.
    finish({ document: {}, workbook: {} });
    await pending;
    expect(useProjectStore.getState().products.map((p) => p.id)).toEqual(original.products.map((p) => p.id));
    expect(useProjectStore.getState().step).toBe("preview");
  });
  it("ignores a late parsing error after restarting the import", async () => {
    let fail!: (error: Error) => void;
    mocks.parse.mockImplementation(() => new Promise((_, reject) => { fail = reject; }));
    const pending = useProjectStore.getState().startDocumentImport(new File(["fake"], "new.xlsx"));
    await vi.waitFor(() => expect(mocks.parse).toHaveBeenCalled());
    useProjectStore.getState().resetImport();
    fail(new Error("late parsing failure"));
    await pending;
    expect(useProjectStore.getState().importProgress.phase).toBe("idle");
    expect(useProjectStore.getState().importSession).toBeUndefined();
  });
});
