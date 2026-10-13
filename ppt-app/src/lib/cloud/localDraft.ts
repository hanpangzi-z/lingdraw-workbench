import { DRAFT_PART_BYTES, decodeDraft, encodeDraft } from "./draftCodec";

type Head = { version: 2; chunks: number; assets: { id: string; parts: number }[]; deleted?: boolean };
const queued = new Map<string, Promise<void>>();
async function database(legacy = false) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    // Separate name keeps old tabs compatible with their version-1 database.
    const request = indexedDB.open(legacy ? "lingdraw-ppt-local-drafts" : "lingdraw-ppt-local-drafts-v2", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("drafts");
      if (!legacy) request.result.createObjectStore("parts");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function readDraft<T>(key: string, rejectCompleted = false): Promise<T | undefined> {
  // A fast remount must not restore an older checkpoint while encoding is in flight.
  await queued.get(key);
  const db = await database();
  let stored: { head?: Head; blobs: Map<string, Blob[]> };
  try {
    stored = await new Promise((resolve, reject) => {
      const tx = db.transaction(["drafts", "parts"]);
      const blobs = new Map<string, Blob[]>();
      let head: Head | undefined;
      let failure: unknown;
      const request = tx.objectStore("drafts").get(key);
      request.onsuccess = () => {
        try {
          head = request.result;
          if (!head || head.deleted) return;
          if (head.version !== 2 || !Number.isSafeInteger(head.chunks) || head.chunks < 1) throw new Error("草稿格式不受支持，原草稿已保留");
          for (const entry of [{ id: "metadata", parts: head.chunks }, ...head.assets]) {
            const parts: Blob[] = []; blobs.set(entry.id, parts);
            for (let index = 0; index < entry.parts; index++) {
              const get = tx.objectStore("parts").get([key, entry.id, index]);
              get.onsuccess = () => {
                if (!(get.result instanceof Blob)) { failure = new Error("草稿附件不完整，原草稿已保留"); tx.abort(); return; }
                parts[index] = get.result;
              };
            }
          }
        } catch (error) { failure = error; tx.abort(); }
      };
      tx.oncomplete = () => resolve({ head, blobs });
      tx.onabort = () => reject(failure || tx.error || new Error("读取草稿失败"));
    });
  } finally { db.close(); }
  if (!stored.head) {
    const legacy = await database(true);
    try {
      return await new Promise<T | undefined>((resolve, reject) => {
        const request = legacy.transaction("drafts").objectStore("drafts").get(key);
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
    } finally { legacy.close(); }
  }
  if (stored.head.deleted) {
    if (rejectCompleted) throw new Error("此草稿已完成创建，请返回项目列表查看，或新建空白项目。");
    return undefined;
  }
  const assets = new Map([...stored.blobs].map(([id, parts]) => [id, new Blob(parts)]));
  return decodeDraft<T>(assets.get("metadata")!, assets);
}

async function commitDraft(key: string, value: unknown) {
  // Do asynchronous encoding before opening the transaction: it must stay active.
  const encoded = value === undefined ? undefined : await encodeDraft(value);
  const count = (blob: Blob) => Math.max(1, Math.ceil(blob.size / DRAFT_PART_BYTES));
  const head: Head = encoded
    ? { version: 2, chunks: count(encoded.metadata), assets: [...encoded.assets].map(([id, blob]) => ({ id, parts: count(blob) })) }
    : { version: 2, chunks: 0, assets: [], deleted: true };
  if (JSON.stringify(head).length > 1024 * 1024) throw new Error("草稿附件数量过多，原草稿已保留");
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["drafts", "parts"], "readwrite");
      const heads = tx.objectStore("drafts"), parts = tx.objectStore("parts");
      let failure: unknown;
      const request = heads.get(key);
      request.onsuccess = () => {
        try {
          const previous = request.result as Head | undefined;
          const retained = new Map(head.assets.map(entry => [entry.id, entry.parts]));
          const oldAssets = new Map(previous?.assets.map(entry => [entry.id, entry.parts]) || []);
          for (const entry of previous?.assets || []) {
            if (!retained.has(entry.id)) for (let index = 0; index < entry.parts; index++) parts.delete([key, entry.id, index]);
          }
          for (let index = head.chunks; index < (previous?.chunks || 0); index++) parts.delete([key, "metadata", index]);
          if (encoded) {
            for (const [id, blob] of [...encoded.assets, ["metadata", encoded.metadata] as const]) {
              if (id !== "metadata" && oldAssets.get(id) === count(blob)) continue;
              for (let index = 0; index < count(blob); index++) parts.put(blob.slice(index * DRAFT_PART_BYTES, (index + 1) * DRAFT_PART_BYTES), [key, id, index]);
            }
          }
          // Head and all parts are committed atomically; failure leaves the prior draft.
          // Tombstones prevent an old version-1 draft from resurfacing after success.
          heads.put(head, key);
        } catch (error) { failure = error; tx.abort(); }
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(failure || tx.error || new Error("保存草稿失败"));
    });
  } finally { db.close(); }
}

export function writeDraft(key: string, value: unknown): Promise<void> {
  const pending = (queued.get(key) || Promise.resolve()).catch(() => undefined).then(() => commitDraft(key, value));
  queued.set(key, pending);
  const cleanup = () => { if (queued.get(key) === pending) queued.delete(key); };
  pending.then(cleanup, cleanup);
  return pending;
}
