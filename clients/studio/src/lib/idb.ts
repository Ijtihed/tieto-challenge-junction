const DB_NAME = "schema-studio";
const DB_VERSION = 1;
const GRAPH_STORE = "graphs";
const POSITIONS_STORE = "positions";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(GRAPH_STORE)) {
        db.createObjectStore(GRAPH_STORE);
      }
      if (!db.objectStoreNames.contains(POSITIONS_STORE)) {
        db.createObjectStore(POSITIONS_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbPut(storeName: string, key: string, value: unknown): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readwrite");
        tx.objectStore(storeName).put(value, key);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      }),
  );
}

function idbGet<T>(storeName: string, key: string): Promise<T | undefined> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readonly");
        const req = tx.objectStore(storeName).get(key);
        req.onsuccess = () => { db.close(); resolve(req.result as T | undefined); };
        req.onerror = () => { db.close(); reject(req.error); };
      }),
  );
}

function idbDelete(storeName: string, key: string): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readwrite");
        tx.objectStore(storeName).delete(key);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      }),
  );
}

export interface CachedGraph {
  graph: unknown;
  repo: unknown;
  rules?: unknown[];
  violations?: unknown[];
  insights?: unknown[];
  savedAt: number;
}

export function saveGraphToIDB(repoKey: string, data: CachedGraph): Promise<void> {
  return idbPut(GRAPH_STORE, repoKey, data);
}

export function loadGraphFromIDB(repoKey: string): Promise<CachedGraph | undefined> {
  return idbGet<CachedGraph>(GRAPH_STORE, repoKey);
}

export interface PositionEntry {
  nodeId: string;
  x: number;
  y: number;
}

export function savePositions(key: string, positions: PositionEntry[]): Promise<void> {
  return idbPut(POSITIONS_STORE, key, positions);
}

export function loadPositions(key: string): Promise<PositionEntry[] | undefined> {
  return idbGet<PositionEntry[]>(POSITIONS_STORE, key);
}

export function deletePositions(key: string): Promise<void> {
  return idbDelete(POSITIONS_STORE, key);
}
