import { createBoardStore } from './persistence.js';

export function createServerBoardStore(username, onStatus = () => {}, request = globalThis.fetch, factory = globalThis.indexedDB) {
  const local = createBoardStore(username, factory);
  let envelope;
  async function api(path = '', options = {}) {
    const response = await request(`/api/drawing/boards${path}`, {
      credentials: 'same-origin', cache: 'no-store', ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
    });
    const value = await response.json();
    if (!response.ok) {
      const error = new Error(value.detail || '服务器保存失败');
      error.status = response.status;
      throw error;
    }
    return value;
  }
  async function keep(payload, dirty = true) {
    envelope = { ...envelope, syncVersion: 1, payload, dirty, import_key: envelope?.import_key || crypto.randomUUID() };
    await local.save(envelope);
  }
  async function save(payload) {
    await keep(payload);
    try {
      let saved;
      if (!envelope.id) {
        envelope.pendingCreatePayload ??= payload;
        await local.save(envelope);
        saved = await api('', { method: 'POST', body: JSON.stringify({ payload: envelope.pendingCreatePayload, import_key: envelope.import_key }) });
        const changed = JSON.stringify(payload) !== JSON.stringify(envelope.pendingCreatePayload);
        // A lost POST response must not acknowledge newer local edits as saved.
        // Revision 1 also prevents overwriting remote edits to that import.
        envelope = { ...envelope, id: saved.id, revision: changed ? 1 : saved.revision };
        delete envelope.pendingCreatePayload;
        await local.save(envelope);
        if (changed) saved = await api(`/${envelope.id}`, { method: 'PUT', body: JSON.stringify({ payload, revision: 1 }) });
      } else {
        saved = await api(`/${envelope.id}`, { method: 'PUT', body: JSON.stringify({ payload, revision: envelope.revision }) });
      }
      envelope = { ...envelope, id: saved.id, revision: saved.revision, payload: saved.payload, dirty: false };
      await local.save(envelope);
      onStatus('saved');
      return { localOnly: false };
    } catch (error) {
      onStatus(error.status === 409 ? 'conflict' : 'local');
      if (error.status === 409 || error.status === 401 || error.status === 403 || error.status === 404) throw error;
      return { localOnly: true };
    }
  }
  return {
    async load() {
      const cached = await local.load();
      envelope = cached?.syncVersion === 1 ? cached : undefined;
      if (cached && !envelope) {
        // Persist the import identity before the first request, so a refresh after
        // an uncertain response cannot create a second imported document.
        await keep(cached);
        await save(cached);
        return envelope.payload;
      }
      if (envelope?.dirty) { onStatus('local'); return envelope.payload; }
      try {
        let id = envelope?.id;
        if (!id) id = (await api()).boards[0]?.id;
        if (!id) return undefined;
        const saved = await api(`/${id}`);
        envelope = { syncVersion: 1, id: saved.id, revision: saved.revision, payload: saved.payload, dirty: false, import_key: crypto.randomUUID() };
        await local.save(envelope);
        onStatus('saved');
        return saved.payload;
      } catch (error) {
        if (!envelope?.payload || error.status === 401 || error.status === 403) throw error;
        onStatus(error.status === 404 ? 'conflict' : 'local');
        return envelope.payload;
      }
    },
    save,
    async saveCopy(payload) {
      envelope = { syncVersion: 1, import_key: crypto.randomUUID() };
      return save(payload);
    },
    async loadServer(id = envelope?.id) {
      if (!id) return this.load();
      // Retain the unsynced copy under a separate local key before discarding it.
      const recovery = createBoardStore(`${username}:recovery:${Date.now()}`, factory);
      await recovery.save(envelope); recovery.close();
      const saved = await api(`/${id}`);
      envelope = { ...envelope, id: saved.id, payload: saved.payload, revision: saved.revision, dirty: false };
      await local.save(envelope); onStatus('saved');
      return saved.payload;
    },
    async clear() {
      if (envelope?.id) await api(`/${envelope.id}?revision=${envelope.revision}`, { method: 'DELETE' });
      await local.clear(); envelope = undefined;
    },
    close: () => local.close(),
    isDirty: () => !!envelope?.dirty,
    list: async () => (await api()).boards,
    currentId: () => envelope?.id || '',
  };
}
