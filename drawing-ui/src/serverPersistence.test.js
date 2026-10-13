import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createBoardStore } from './persistence.js';
import { createServerBoardStore } from './serverPersistence.js';

function server() {
  const rows = new Map(), imports = new Map();
  let losePost = false;
  const response = (status, value) => ({ ok: status < 400, status, json: async () => structuredClone(value) });
  return { rows, loseNextPost() { losePost = true; }, async fetch(url, options) {
    const method = options.method || 'GET';
    const id = url.split('/')[4]?.split('?')[0];
    const body = options.body ? JSON.parse(options.body) : undefined;
    if (method === 'GET') return response(200, id ? rows.get(id) : { boards: [...rows.values()].reverse() });
    if (method === 'POST') {
      let row = rows.get(imports.get(body.import_key));
      if (!row) { row = { id: crypto.randomUUID(), revision: 1, payload: body.payload }; rows.set(row.id, row); imports.set(body.import_key, row.id); }
      if (losePost) { losePost = false; throw new TypeError('network response lost'); }
      return response(200, row);
    }
    const row = rows.get(id);
    if (row.revision !== body.revision) return response(409, { detail: 'conflict' });
    Object.assign(row, { payload: body.payload, revision: row.revision + 1 });
    return response(200, row);
  } };
}

test('legacy cache imports independently of existing server documents, once', async () => {
  const factory = new IDBFactory(), remote = server();
  const other = createServerBoardStore('alice', () => {}, remote.fetch, new IDBFactory());
  await other.save({ name: 'server', elements: [] });
  const legacy = createBoardStore('alice', factory);
  await legacy.save({ name: 'legacy', elements: [] }); legacy.close();
  let store = createServerBoardStore('alice', () => {}, remote.fetch, factory);
  assert.equal((await store.load()).name, 'legacy'); store.close();
  store = createServerBoardStore('alice', () => {}, remote.fetch, factory);
  assert.equal((await store.load()).name, 'legacy');
  assert.equal(remote.rows.size, 2); store.close(); other.close();
});

test('lost create response followed by newer edits preserves latest content on retry', async () => {
  const factory = new IDBFactory(), remote = server();
  let store = createServerBoardStore('alice', () => {}, remote.fetch, factory);
  remote.loseNextPost();
  assert.equal((await store.save({ name: 'old' })).localOnly, true); store.close();
  store = createServerBoardStore('alice', () => {}, remote.fetch, factory);
  assert.equal((await store.load()).name, 'old');
  await store.save({ name: 'new' });
  assert.equal(remote.rows.size, 1);
  assert.equal([...remote.rows.values()][0].payload.name, 'new'); store.close();
});

test('two devices conflict without overwriting, then preserve local edits as separate copy', async () => {
  const remote = server();
  const a = createServerBoardStore('alice', () => {}, remote.fetch, new IDBFactory());
  const b = createServerBoardStore('alice', () => {}, remote.fetch, new IDBFactory());
  await a.save({ name: 'initial' }); await b.load();
  await a.save({ name: 'device a' });
  await assert.rejects(b.save({ name: 'device b' }), error => error.status === 409);
  assert.equal(b.isDirty(), true);
  assert.equal([...remote.rows.values()][0].payload.name, 'device a');
  await b.saveCopy({ name: 'device b' });
  assert.equal(remote.rows.size, 2); a.close(); b.close();
});
