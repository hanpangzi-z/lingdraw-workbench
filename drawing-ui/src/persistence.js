const DATABASE = 'lingdraw-drawing-v1';
const STORE = 'boards';

export function createBoardStore(username, factory = globalThis.indexedDB) {
  if (!username) throw new Error('A signed-in account is required');
  const key = username.trim().toLowerCase();
  let database;

  function open() {
    if (database) return Promise.resolve(database);
    return new Promise((resolve, reject) => {
      if (!factory) return reject(new Error('Browser storage is unavailable'));
      const request = factory.open(DATABASE, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onblocked = () => reject(new Error('Close other drawing tabs and retry'));
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        database = request.result;
        database.onversionchange = () => { database.close(); database = undefined; };
        resolve(database);
      };
    });
  }

  async function transact(mode, value, remove = false) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = mode === 'readonly'
        ? tx.objectStore(STORE).get(key)
        : remove ? tx.objectStore(STORE).delete(key) : tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve(mode === 'readonly' ? request.result : undefined);
      tx.onabort = () => reject(tx.error || new Error('Save was interrupted'));
      tx.onerror = () => reject(tx.error || request.error);
    });
  }

  return {
    load: () => transact('readonly'),
    save: (value) => transact('readwrite', value),
    clear: () => transact('readwrite', undefined, true),
    close: () => { database?.close(); database = undefined; },
  };
}

// Store document/view settings only; transient collaborators and selection are not serializable document state.
export function documentState(state) {
  const keys = ['viewBackgroundColor', 'scrollX', 'scrollY', 'zoom', 'gridSize', 'gridStep', 'gridModeEnabled',
    'currentItemStrokeColor', 'currentItemBackgroundColor', 'currentItemFillStyle', 'currentItemStrokeWidth',
    'currentItemStrokeStyle', 'currentItemRoughness', 'currentItemOpacity', 'currentItemFontFamily',
    'currentItemFontSize', 'currentItemTextAlign', 'currentItemStartArrowhead', 'currentItemEndArrowhead'];
  return Object.fromEntries(keys.filter(key => state[key] !== undefined).map(key => [key, state[key]]));
}
