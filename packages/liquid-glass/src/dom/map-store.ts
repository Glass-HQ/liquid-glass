/** Material maps persisted across page loads. A reload then draws its glass
 * from the store in the first frames, before the GPU device has even been
 * requested. Entries are keyed by geometry and the renderer version, so a
 * shader or encoder change never shows stale maps. Lookups and writes are
 * batched per task into one transaction each. */
export interface StoredMaps {
  planes: string[][];
  duration: number;
}
interface Entry extends StoredMaps { key: string; used: number }
const name = "liquid-glass";
const store = "maps";
/** Entries beyond this are evicted least recently used first. Only resting
 * shapes are stored, so a page needs a few dozen at most. */
const capacity = 256;
let opening: Promise<IDBDatabase | undefined> | undefined;
function open(): Promise<IDBDatabase | undefined> {
  if (opening) return opening;
  return opening = new Promise((resolve) => {
    let db: IDBOpenDBRequest;
    try {
      if (typeof indexedDB === "undefined") return resolve(undefined);
      db = indexedDB.open(name, 1);
    } catch {
      return resolve(undefined);
    }
    db.onupgradeneeded = () => {
      const maps = db.result.createObjectStore(store, { keyPath: "key" });
      maps.createIndex("used", "used");
    };
    db.onsuccess = () => {
      db.result.onversionchange = () => { db.result.close(); opening = undefined; };
      resolve(db.result);
    };
    db.onerror = () => resolve(undefined);
    db.onblocked = () => resolve(undefined);
  });
}
const reads = new Map<string, { resolve: (maps: StoredMaps | undefined) => void }[]>();
let reading = false;
/** Everything in the store, read once at startup so the first frame of a page
 * can find its maps without a storage roundtrip. Entries are released from
 * memory as they are claimed, or when startup is long over. */
let preloaded: Map<string, StoredMaps> | undefined;
let preloading: Promise<void> | undefined;
export function preloadStoredMaps(prefix: string): Promise<void> {
  readFirstPaint(prefix);
  return preloading ??= (async () => {
    const db = await open();
    if (!db) return;
    const all = await new Promise<Entry[]>((resolve) => {
      try {
        const request = db.transaction(store, "readonly").objectStore(store).getAll();
        request.onsuccess = () => resolve(request.result as Entry[]);
        request.onerror = () => resolve([]);
      } catch { resolve([]); }
    });
    const found = all.filter((entry) => entry.key.startsWith(prefix));
    preloaded = new Map(found.map((entry) => [entry.key, { planes: entry.planes, duration: entry.duration }]));
    // Maps from an earlier renderer version are never read again; drop them
    // once startup is over, so they stop weighing on the next load.
    const stale = all.filter((entry) => !entry.key.startsWith(prefix)).map((entry) => entry.key);
    if (stale.length) setTimeout(() => {
      try {
        const maps = db.transaction(store, "readwrite").objectStore(store);
        for (const key of stale) maps.delete(key);
      } catch { /* The store answers again on the next load. */ }
    }, 5000);
    setTimeout(() => { preloaded = undefined; }, 30_000);
  })();
}
/** Maps stored for `key`, or undefined when absent or storage is unavailable. */
export function loadStoredMaps(key: string): Promise<StoredMaps | undefined> {
  const ready = peekStoredMaps(key);
  if (ready) return Promise.resolve(ready);
  return new Promise((resolve) => {
    const waiting = reads.get(key) ?? [];
    waiting.push({ resolve });
    reads.set(key, waiting);
    if (!reading) {
      reading = true;
      queueMicrotask(flushReads);
    }
  });
}
/** Keys present in the preloaded store, for decoding ahead of first use. */
export function preloadedKeys(): string[] {
  return [...(preloaded?.keys() ?? [])];
}

/** The maps a page needed in its first moments, kept in localStorage as
 * well. IndexedDB answers in a task, which cannot run while a framework is
 * still mounting the page; localStorage answers synchronously, so the first
 * frame that measures a surface can draw its glass at once. */
const firstPaintKey = "liquid-glass:first-paint";
const firstPaintLimit = 3_000_000;
let firstPaint: Map<string, StoredMaps> | undefined;
let firstPaintPrefix = "";
const started = typeof performance === "undefined" ? 0 : performance.now();
const claimed: string[] = [];
let firstPaintWrite: ReturnType<typeof setTimeout> | undefined;
function readFirstPaint(prefix: string): Map<string, StoredMaps> {
  firstPaintPrefix = prefix;
  if (firstPaint) return firstPaint;
  firstPaint = new Map();
  try {
    const raw = localStorage.getItem(firstPaintKey);
    if (raw) {
      const parsed = JSON.parse(raw) as { prefix: string; entries: [string, StoredMaps][] };
      if (parsed.prefix === prefix) for (const [key, maps] of parsed.entries) firstPaint.set(key, maps);
    }
  } catch { /* Storage may be unavailable or corrupt; the store still answers. */ }
  return firstPaint;
}
/** Maps available without waiting: the first-paint set, then the preloaded store. */
export function peekStoredMaps(key: string): StoredMaps | undefined {
  const maps = firstPaint?.get(key) ?? preloaded?.get(key);
  if (maps) touch(key);
  return maps;
}
/** Remember that `key` was needed early in this session, so the next load
 * finds it synchronously. Writes happen once things have settled. */
export function claimFirstPaint(key: string, maps: StoredMaps): void {
  if (!firstPaintPrefix || performance.now() - started > 4000 || claimed.includes(key)) return;
  claimed.push(key);
  firstPaint?.set(key, maps);
  firstPaintWrite ??= setTimeout(() => {
    firstPaintWrite = undefined;
    const entries: [string, StoredMaps][] = [];
    let size = 0;
    for (const key of claimed) {
      const maps = firstPaint?.get(key);
      if (!maps) continue;
      size += key.length + maps.planes.flat().reduce((n, url) => n + url.length, 0);
      if (size > firstPaintLimit) break;
      entries.push([key, maps]);
    }
    try { localStorage.setItem(firstPaintKey, JSON.stringify({ prefix: firstPaintPrefix, entries })); }
    catch { /* Quota or availability; the store remains the source of truth. */ }
  }, 2500);
}
async function flushReads() {
  reading = false;
  const batch = new Map(reads);
  reads.clear();
  // A lookup racing the startup read waits for it rather than hitting storage twice.
  if (preloading && !preloaded) {
    await preloading;
    const loaded = preloaded as Map<string, StoredMaps> | undefined;
    for (const [key, waiting] of [...batch]) {
      const ready = loaded?.get(key);
      if (ready) { for (const w of waiting) w.resolve(ready); batch.delete(key); touch(key); }
    }
    if (!batch.size) return;
  }
  const db = await open();
  const settle = (key: string, value: StoredMaps | undefined) => { for (const w of batch.get(key)!) w.resolve(value); };
  if (!db) { for (const key of batch.keys()) settle(key, undefined); return; }
  let transaction: IDBTransaction;
  try { transaction = db.transaction(store, "readonly"); } catch { for (const key of batch.keys()) settle(key, undefined); return; }
  const maps = transaction.objectStore(store);
  for (const key of batch.keys()) {
    const request = maps.get(key);
    request.onsuccess = () => {
      const record = request.result as Entry | undefined;
      settle(key, record ? { planes: record.planes, duration: record.duration } : undefined);
      if (record) touch(key);
    };
    request.onerror = () => settle(key, undefined);
  }
}
const touched = new Set<string>();
const writes = new Map<string, StoredMaps>();
let writing: ReturnType<typeof setTimeout> | undefined;
/** Mark a stored entry as recently used, at most once per session. */
function touch(key: string) {
  if (touched.has(key)) return;
  touched.add(key);
  scheduleWrites();
}
/** Persist freshly encoded maps. Writes are deferred so they never share a
 * frame with the animation that produced them. */
export function saveStoredMaps(key: string, maps: StoredMaps): void {
  writes.set(key, maps);
  touched.add(key);
  scheduleWrites();
}
function scheduleWrites() {
  writing ??= setTimeout(flushWrites, 400);
}
async function flushWrites() {
  writing = undefined;
  const pending = new Map(writes);
  writes.clear();
  const refresh = [...touched].filter((key) => !pending.has(key));
  touched.clear();
  const db = await open();
  if (!db) return;
  let transaction: IDBTransaction;
  try { transaction = db.transaction(store, "readwrite"); } catch { return; }
  const maps = transaction.objectStore(store);
  const now = Date.now();
  for (const [key, value] of pending) maps.put({ key, used: now, ...value } satisfies Entry);
  for (const key of refresh) {
    const request = maps.get(key);
    request.onsuccess = () => { if (request.result) maps.put({ ...request.result, used: now }); };
  }
  transaction.onerror = () => undefined;
  if (pending.size) {
    // Drop the oldest entries once the store outgrows its capacity.
    const count = maps.count();
    count.onsuccess = () => {
      let excess = count.result - capacity;
      if (excess <= 0) return;
      const cursor = maps.index("used").openCursor();
      cursor.onsuccess = () => {
        const current = cursor.result;
        if (!current || excess-- <= 0) return;
        current.delete();
        current.continue();
      };
    };
  }
}
