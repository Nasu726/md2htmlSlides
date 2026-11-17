/**
 * 下書きの自動保存（#73、設計プラン §9.1）。IndexedDB に、資料ごとの下書きと、最後に開いた資料を残す。
 * IndexedDB が使えないとき（プライベートモードなど）は、何もしない。
 */
const DB = 'mds-editor';
const STORE = 'kv';

let opening: Promise<IDBDatabase | undefined> | undefined;

function open(): Promise<IDBDatabase | undefined> {
  opening ??= new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
  return opening;
}

async function run<T>(mode: IDBTransactionMode, body: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await open();
  if (!db) return undefined;
  return new Promise<T | undefined>((resolve) => {
    try {
      const request = body(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

export const getItem = <T>(key: string) => run<T>('readonly', (store) => store.get(key));
export const setItem = (key: string, value: unknown) =>
  run('readwrite', (store) => store.put(value, key));
export const removeItem = (key: string) => run('readwrite', (store) => store.delete(key));

/** 下書き */
export interface Draft {
  text: string;
  /** 保存した時刻（ミリ秒） */
  time: number;
}

/** 最後に開いていた資料（起動したときに開き直す） */
export interface LastDocument {
  key: string;
  name: string;
  text: string;
  time: number;
}
