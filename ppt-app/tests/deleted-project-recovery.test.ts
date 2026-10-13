import { beforeEach, describe, expect, it, vi } from "vitest";
import { CloudApiError, isProjectDeleted } from "@/src/lib/cloud/apiError";
import { draftForNewProject, prepareRecoveredDraft } from "@/src/lib/cloud/pendingRecovery";
import { writeDraft } from "@/src/lib/cloud/localDraft";

vi.mock("@/src/lib/cloud/localDraft", () => ({ writeDraft: vi.fn() }));
const fixture = () => ({
  files: [new File(["excel"], "source.xlsx"), new File(["image"], "source.png")],
  created: { id: "deleted-project", revision: 8 }, imageUploads: { hash: "/old-project/image" }, sourceUploadedIndices: [0],
  sourceFilesComplete: true, projectDeleted: true,
  state: { products: [{ name: "保留商品", image: "data:image/png;base64,eA==" }], mapping: { title: "商品名称" }, editor: { title: "手动编辑" } },
  batch: { groups: [{ name: "分组" }] },
});
beforeEach(() => { vi.clearAllMocks(); vi.mocked(writeDraft).mockResolvedValue(undefined); });

describe("deleted project recovery", () => {
  it("only recovers the explicit authenticated deleted-project response", () => {
    expect(isProjectDeleted(new CloudApiError("项目已删除", 404, "PROJECT_DELETED"))).toBe(true);
    for (const error of [new Error("项目已删除"), new CloudApiError("项目已删除", 404, "NOT_FOUND"), new CloudApiError("denied", 403), new CloudApiError("login", 401), new CloudApiError("timeout", 504)]) {
      expect(isProjectDeleted(error)).toBe(false);
    }
  });
  it("clears project-specific identity and receipts but keeps every source file and edit", () => {
    const original = fixture(); const next = draftForNewProject(original);
    expect(next).toMatchObject({ created: undefined, imageUploads: {}, sourceUploadedIndices: [], projectDeleted: false });
    expect(next.state).toEqual(original.state); expect(next.batch).toEqual(original.batch);
    expect(next.files).toEqual(original.files); expect(next.files).toHaveLength(2);
    expect(original.created.id).toBe("deleted-project"); expect(original.sourceUploadedIndices).toEqual([0]);
  });
  it("blocks legacy drafts of unknown completeness before any write or pointer change", async () => {
    const pointer = vi.fn();
    await expect(prepareRecoveredDraft("slot", { ...fixture(), sourceFilesComplete: undefined }, pointer)).rejects.toThrow("补选全部原始资料");
    expect(writeDraft).not.toHaveBeenCalled(); expect(pointer).not.toHaveBeenCalled();
  });
  it("switches to a new idempotency key only after the new draft has been saved", async () => {
    let finish!: () => void;
    vi.mocked(writeDraft).mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const pointer = vi.fn(); const pending = prepareRecoveredDraft("slot", fixture(), pointer);
    await vi.waitFor(() => expect(writeDraft).toHaveBeenCalledOnce());
    expect(pointer).not.toHaveBeenCalled(); finish();
    const result = await pending;
    expect(result.creationKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(writeDraft).toHaveBeenCalledWith(result.key, result.draft);
    expect(pointer).toHaveBeenCalledWith("slot", result.creationKey);
  });
  it("does not change the recovery pointer on quota or blob preservation failure", async () => {
    const pointer = vi.fn();
    vi.mocked(writeDraft).mockRejectedValueOnce(new Error("quota"));
    await expect(prepareRecoveredDraft("slot", fixture(), pointer)).rejects.toThrow("quota");
    expect(pointer).not.toHaveBeenCalled();
    vi.mocked(writeDraft).mockRejectedValueOnce(new Error("blob lost"));
    await expect(prepareRecoveredDraft("slot", fixture(), pointer)).rejects.toThrow("blob lost");
    expect(pointer).not.toHaveBeenCalled();
  });
  it("keeps the saved copy if session storage cannot switch, without deleting the old draft", async () => {
    await expect(prepareRecoveredDraft("slot", fixture(), () => { throw new Error("session unavailable"); })).rejects.toThrow("session unavailable");
    expect(writeDraft).toHaveBeenCalledOnce();
    expect(vi.mocked(writeDraft).mock.calls[0][1]).toMatchObject({ state: fixture().state });
  });
  it("can retry a failed durable save without changing the old data or creating prematurely", async () => {
    const pointer = vi.fn(); const original = fixture();
    vi.mocked(writeDraft).mockRejectedValueOnce(new Error("quota"));
    await expect(prepareRecoveredDraft("slot", original, pointer)).rejects.toThrow("quota");
    expect(pointer).not.toHaveBeenCalled();
    await prepareRecoveredDraft("slot", original, pointer);
    expect(pointer).toHaveBeenCalledOnce(); expect(original.created.id).toBe("deleted-project");
  });
});
