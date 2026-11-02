import { emptyProgress, sanitizeProgress, store, GLOBAL_DATASET, type Progress } from "../store/store";
import { wordKey } from "./text";
import { apiGet, apiPut, auth, fetchRegisterOpen, refreshMe } from "./auth";
import { applyServerPrefs, datasetsStore } from "./datasets";
import { ensureSenseBaseline } from "./senses";

interface Meta {
  owner: string | null;
  localTs: number;
  syncedTs: number;
}

const GLOBAL = GLOBAL_DATASET;
const metaKey = (ds: string) => `word-atlas:sync:${ds}`;
const progressKey = (ds: string) => `word-atlas:v2:${ds}`;

function readMeta(ds: string): Meta {
  try {
    const m = JSON.parse(localStorage.getItem(metaKey(ds)) || "null");
    if (m && typeof m.localTs === "number")
      return { owner: m.owner ?? null, localTs: m.localTs, syncedTs: m.syncedTs ?? 0 };
  } catch {
    /* fall through */
  }
  return { owner: null, localTs: 0, syncedTs: 0 };
}

function writeMeta(ds: string, m: Meta) {
  try {
    localStorage.setItem(metaKey(ds), JSON.stringify(m));
  } catch {
    /* ignore */
  }
}

/** Write a server copy into local storage and adopt it into the store. */
function adoptCopy(progress: Progress, clientTs: number, owner: string) {
  const clean = sanitizeProgress({ ...progress, session: null }, GLOBAL);
  try {
    localStorage.setItem(progressKey(GLOBAL), JSON.stringify(clean));
  } catch {
    /* ignore */
  }
  writeMeta(GLOBAL, { owner, localTs: clientTs, syncedTs: clientTs });
  store.adoptProgress(clean);
  lastProgressRef = store.get().progress;
}

const reconciled = new Set<string>();
let lastProgressRef: Progress | null = null;
let uploadTimer: number | undefined;
let started = false;

function scheduleUpload() {
  if (!auth.get().user) return;
  window.clearTimeout(uploadTimer);
  uploadTimer = window.setTimeout(() => void uploadNow(), 1200);
}

async function uploadNow() {
  const user = auth.get().user;
  if (!user) return;
  const p = store.get().progress;
  if (!reconciled.has(GLOBAL)) {
    void syncGlobal();
    return;
  }
  const meta = readMeta(GLOBAL);
  if (meta.owner !== user.username) return;
  if (meta.localTs <= meta.syncedTs) return;
  auth.setSync("syncing");
  try {
    await apiPut("/progress", {
      dataset: GLOBAL,
      progress: { ...p, session: null },
      clientTs: meta.localTs,
    });
    const m2 = readMeta(GLOBAL);
    if (m2.localTs === meta.localTs) {
      m2.syncedTs = meta.localTs;
      writeMeta(GLOBAL, m2);
    }
    auth.setSync("idle");
  } catch {
    auth.setSync("error");
  }
}

/** Reconcile the shared pool with its server copy. */
export async function syncGlobal() {
  const user = auth.get().user;
  if (!user) return;
  const meta = readMeta(GLOBAL);
  let server: { progress: Progress | null; clientTs: number } = { progress: null, clientTs: 0 };
  try {
    const d = await apiGet(`/progress?dataset=${GLOBAL}`);
    server = { progress: d.progress ?? null, clientTs: d.clientTs ?? 0 };
  } catch {
    auth.setSync("error");
    return;
  }
  if (meta.owner && meta.owner !== user.username) {
    // This device holds another account's local pool: never upload it here.
    if (server.progress) adoptCopy(server.progress, server.clientTs, user.username);
    else {
      try {
        localStorage.removeItem(progressKey(GLOBAL));
      } catch {
        /* ignore */
      }
      writeMeta(GLOBAL, { owner: user.username, localTs: 0, syncedTs: 0 });
      store.adoptProgress(emptyProgress(GLOBAL));
      lastProgressRef = store.get().progress;
    }
    reconciled.add(GLOBAL);
    return;
  }
  meta.owner = user.username;
  writeMeta(GLOBAL, meta);
  if (server.progress && server.clientTs > meta.localTs) {
    adoptCopy(server.progress, server.clientTs, user.username);
  } else {
    // Use the in-memory progress: the localStorage copy may lag a just-applied
    // change (e.g. the legacy merge) by one debounced flush.
    const local = store.get().progress;
    if (local && meta.localTs > server.clientTs) {
      auth.setSync("syncing");
      try {
        await apiPut("/progress", {
          dataset: GLOBAL,
          progress: { ...local, session: null },
          clientTs: meta.localTs,
        });
        const m2 = readMeta(GLOBAL);
        m2.syncedTs = meta.localTs;
        writeMeta(GLOBAL, m2);
      } catch {
        auth.setSync("error");
        return;
      }
    }
  }
  reconciled.add(GLOBAL);
  auth.setSync("idle");
}

/**
 * Legacy per-dataset server rows are merged into the shared pool exactly once:
 * only while the pool's server copy is still empty. Cards are remapped from
 * entry ids to word keys via each dataset's index file.
 */
async function mergeLegacyServerRows() {
  const user = auth.get().user;
  if (!user) return;
  let g: { progress?: Progress | null } = {};
  try {
    g = await apiGet(`/progress?dataset=${GLOBAL}`);
  } catch {
    return;
  }
  if (g.progress && Object.keys(g.progress.cards ?? {}).length) return;
  const { list, enabled } = datasetsStore.get();
  let merged = false;
  for (const info of list) {
    if (!enabled.includes(info.id)) continue;
    let row: { progress?: Progress | null } = {};
    try {
      row = await apiGet(`/progress?dataset=${encodeURIComponent(info.id)}`);
    } catch {
      continue;
    }
    const cards = row.progress?.cards;
    if (!cards || !Object.keys(cards).length) continue;
    let idToKey = new Map<string, string>();
    try {
      const r = await fetch(`${import.meta.env.BASE_URL}${info.root}/index.json`);
      if (!r.ok) continue;
      const idx = (await r.json()) as { words?: [string, string][] };
      for (const w of idx.words ?? []) idToKey.set(w[0], wordKey(w[1]));
    } catch {
      continue;
    }
    store.progress((p) => {
      const next = { ...p.cards };
      for (const [id, c] of Object.entries(cards)) {
        const k = idToKey.get(id);
        if (!k) continue;
        const cur = next[k];
        if (!cur || c.s > cur.s || (c.s === cur.s && c.due > cur.due)) next[k] = c;
      }
      return { ...p, cards: next };
    });
    merged = true;
  }
  if (merged) {
    const meta = readMeta(GLOBAL);
    meta.owner = user.username;
    meta.localTs = Date.now();
    writeMeta(GLOBAL, meta);
    reconciled.delete(GLOBAL);
  }
}

/** Full post-login sync: account dataset selection, legacy merge, then the pool. */
export async function syncAfterLogin() {
  const user = auth.get().user;
  if (!user) return;
  await applyServerPrefs();
  await mergeLegacyServerRows();
  await syncGlobal();
  void ensureSenseBaseline();
  if (auth.get().syncState !== "error") auth.setSync("idle");
}

/** Manual "sync now" from the account panel. */
export async function syncNow() {
  await syncGlobal();
}

export function initSync() {
  if (started) return;
  started = true;
  lastProgressRef = store.get().progress;
  store.subscribe(() => {
    const p = store.get().progress;
    if (p !== lastProgressRef) {
      lastProgressRef = p;
      const meta = readMeta(GLOBAL);
      const user = auth.get().user;
      if (!meta.owner && user) meta.owner = user.username;
      meta.localTs = Date.now();
      writeMeta(GLOBAL, meta);
      scheduleUpload();
    }
  });
  window.addEventListener("pagehide", () => void uploadNow());
  void (async () => {
    await fetchRegisterOpen();
    const u = await refreshMe();
    if (u) await syncAfterLogin();
  })();
}
