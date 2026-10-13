export function savedDraftIds(storage: Pick<Storage, "getItem">, slot: string): string[] {
  const previous = storage.getItem(slot);
  const raw = storage.getItem(`${slot}:history`);
  const history: unknown = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(history) || history.some(id => typeof id !== "string")) throw new Error("草稿入口列表不可用，原草稿未删除");
  return [...new Set([...(previous ? [previous] : []), ...history as string[]])];
}

/** Retain discoverable recovery entries before switching the current pointer. */
export function rememberDraft(storage: Pick<Storage, "getItem" | "setItem">, slot: string, id: string) {
  const ids = savedDraftIds(storage, slot);
  storage.setItem(`${slot}:history`, JSON.stringify([...new Set([id, ...ids])]));
  storage.setItem(slot, id);
}

export function forgetDraft(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">, slot: string, id: string) {
  storage.setItem(`${slot}:history`, JSON.stringify(savedDraftIds(storage, slot).filter(saved => saved !== id)));
  if (storage.getItem(slot) === id) storage.removeItem(slot);
}
