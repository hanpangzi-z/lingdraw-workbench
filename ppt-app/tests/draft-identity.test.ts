import { describe, expect, it } from "vitest";
import { forgetDraft, rememberDraft, savedDraftIds } from "@/src/lib/cloud/draftIdentity";
const storage = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
};
describe("explicit draft identity", () => {
  it("retains a legacy step-three draft when starting a different blank project", () => {
    const session = storage(); session.setItem("slot", "legacy");
    rememberDraft(session, "slot", "blank");
    expect(session.getItem("slot")).toBe("blank");
    expect(savedDraftIds(session, "slot")).toEqual(["blank", "legacy"]);
    rememberDraft(session, "slot", "legacy");
    expect(savedDraftIds(session, "slot")).toEqual(["legacy", "blank"]);
  });
  it("does not switch the recovery pointer if preserving its history fails", () => {
    const session = storage(); session.setItem("slot", "old");
    const unavailable = { getItem: session.getItem, setItem: () => { throw new Error("quota"); } };
    expect(() => rememberDraft(unavailable, "slot", "new")).toThrow("quota");
    expect(session.getItem("slot")).toBe("old");
  });
  it("removes only completed entries without changing another active draft", () => {
    const session = storage(); rememberDraft(session, "slot", "a"); rememberDraft(session, "slot", "b");
    forgetDraft(session, "slot", "a");
    expect(savedDraftIds(session, "slot")).toEqual(["b"]);
    forgetDraft(session, "slot", "b"); expect(savedDraftIds(session, "slot")).toEqual([]);
  });
});
