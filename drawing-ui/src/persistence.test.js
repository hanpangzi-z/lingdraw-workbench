import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createBoardStore, documentState } from './persistence.js';

test('restores drawing, image data and library after reopening, isolated by account', async () => {
  const factory = new IDBFactory();
  const first = createBoardStore('Alice', factory);
  const scene = { elements: [{ id: 'image1', type: 'image', fileId: 'file1' }, { id: 'note1', type: 'text', text: '中文标注' }], files: { file1: { dataURL: 'data:image/png;base64,dGVzdA==' } }, libraryItems: [{ id: 'shape1' }], appState: { zoom: { value: 1.5 } }, name: '标注方案' };
  await first.save(scene);
  first.close();
  const reopened = createBoardStore('alice', factory);
  const other = createBoardStore('Bob', factory);
  assert.deepEqual(await reopened.load(), scene);
  assert.equal(await other.load(), undefined);
  await other.save({ elements: [], name: 'Other board' });
  assert.deepEqual(await reopened.load(), scene);
  reopened.close(); other.close();
});

test('reset deletes the entire board record including images and library, isolated by account', async () => {
  const factory = new IDBFactory();
  const store = createBoardStore('user', factory);
  const other = createBoardStore('other', factory);
  await store.save({ elements: [{ id: 'old', isDeleted: true }], files: { image: { dataURL: 'data:image/png;base64,old' } }, libraryItems: [{ id: 'cached-shape' }], name: 'Old board' });
  await other.save({ name: 'Keep this board' });
  await store.clear();
  store.close();
  const reopened = createBoardStore('user', factory);
  assert.equal(await reopened.load(), undefined);
  assert.deepEqual(await other.load(), { name: 'Keep this board' });
  await reopened.save({ elements: [{ id: 'new' }], files: {} });
  assert.deepEqual(await reopened.load(), { elements: [{ id: 'new' }], files: {} });
  reopened.close(); other.close();
});

test('surfaces storage failures and rejects unauthenticated persistence', async () => {
  assert.throws(() => createBoardStore('', new IDBFactory()));
  const unavailable = createBoardStore('user', null);
  await assert.rejects(unavailable.load(), /unavailable/);
  await assert.rejects(unavailable.save({}), /unavailable/);
  await assert.rejects(unavailable.clear(), /unavailable/);
  const store = createBoardStore('user', new IDBFactory());
  await assert.rejects(store.save({ invalid: () => {} }));
  await store.save({ elements: [] });
  assert.deepEqual(await store.load(), { elements: [] });
  store.close();
});

test('persists useful view/style state and drops transient, non-document data', () => {
  const state = documentState({ zoom: { value: 2 }, scrollX: 20, viewBackgroundColor: '#fff', currentItemStrokeColor: '#f00', collaborators: new Map(), selectedElementIds: { item: true }, editingTextElement: { id: 'editing' }, isLoading: true });
  assert.deepEqual(state, { zoom: { value: 2 }, scrollX: 20, viewBackgroundColor: '#fff', currentItemStrokeColor: '#f00' });
});
