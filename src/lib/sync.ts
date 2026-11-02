import { emptyProgress, sanitizeProgress, store, type Progress } from "../store/store";
import { apiGet, apiPut, auth, fetchRegisterOpen, refreshMe } from "./auth";
import { applyServerPrefs, datasetsStore } from "./datasets";

interface Meta {
  owner: string | null;
  localTs: number;
  syncedTs: number;
}

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

function readLocal(ds: string): Progress | null {
  try {
    const raw = localStorage.getItem(progressKey(ds));
    return raw ? (JSON.parse(raw) as Progress) : null;
  } catch {
    return null;
  }
}

/** Write a server copy into local storage; adopt it into the store if it is the active dataset. */
function adoptCopy(id: string, progress: Progress, clientTs: number, owner: string) {
  const clean = sanitizeProgress({ ...progress, session: null }, id);
  try {
    localStorage.setItem(progressKey(id), JSON.stringify(clean));
  } catch {
    /* ignore */
  }
  writeMeta(id, { owner, localTs: clientTs, syncedTs: clientTs });
  if (store.get().progress.datasetId === id) {
    store.adoptProgress(clean);
    lastProgressRef = store.get().progress;
  }
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
  const ds = p.datasetId;
  if (!reconciled.has(ds)) {
    void syncDataset(ds);
    return;
  }
  const meta = readMeta(ds);
  if (meta.owner !== user.username) return;
  if (meta.localTs <= meta.syncedTs) return;
  auth.setSync("syncing");
  try {
    await apiPut("/progress", {
      dataset: ds,
      progress: { ...p, session: null },
      clientTs: meta.localTs,
    });
    const m2 = readMeta(ds);
    if (m2.localTs === meta.localTs) {
      m2.syncedTs = meta.localTs;
      writeMeta(ds, m2);
    }
    auth.setSync("idle");
  } catch {
    auth.setSync("error");
  }
}

/** Reconcile one dataset's local progress with its server copy. Safe for non-active datasets. */
export async function syncDataset(id: string) {
  const user = auth.get().user;
  if (!user) return;
  const meta = readMeta(id);
  let server: { progress: Progress | null; clientTs: number } = { progress: null, clientTs: 0 };
  try {
    const d = await apiGet(`/progress?dataset=${encodeURIComponent(id)}`);
    server = { progress: d.progress ?? null, clientTs: d.clientTs ?? 0 };
  } catch {
    auth.setSync("error");
    return;
  }
  if (meta.owner && meta.owner !== user.username) {
    // This device holds another account's local data for this dataset: never upload it here.
    if (server.progress) adoptCopy(id, server.progress, server.clientTs, user.username);
    else {
      try {
        localStorage.removeItem(progressKey(id));
      } catch {
        /* ignore */
      }
      writeMeta(id, { owner: user.username, localTs: 0, syncedTs: 0 });
      if (store.get().progress.datasetId === id) {
        store.adoptProgress(emptyProgress(id));
        lastProgressRef = store.get().progress;
      }
    }
    reconciled.add(id);
    return;
  }
  meta.owner = user.username;
  writeMeta(id, meta);
  if (server.progress && server.clientTs > meta.localTs) {
    adoptCopy(id, server.progress, server.clientTs, user.username);
  } else {
    const local = readLocal(id);
    if (local && meta.localTs > server.clientTs) {
      if (meta.localTs === 0) {
        meta.localTs = Date.now();
        writeMeta(id, meta);
      }
      auth.setSync("syncing");
      try {
        await apiPut("/progress", {
          dataset: id,
          progress: { ...local, session: null },
          clientTs: meta.localTs,
        });
        const m2 = readMeta(id);
        m2.syncedTs = meta.localTs;
        writeMeta(id, m2);
      } catch {
        auth.setSync("error");
        return;
      }
    }
  }
  reconciled.add(id);
  auth.setSync("idle");
}

/** Full post-login sync: account dataset selection, then every enabled dataset. */
export async function syncAfterLogin() {
  const user = auth.get().user;
  if (!user) return;
  await applyServerPrefs();
  const { enabled } = datasetsStore.get();
  for (const id of enabled) await syncDataset(id);
  if (auth.get().syncState !== "error") auth.setSync("idle");
}

/** Manual "sync now" from the account panel: reconcile the active dataset. */
export async function syncNow() {
  await syncDataset(store.get().progress.datasetId);
}

export function initSync() {
  if (started) return;
  started = true;
  lastProgressRef = store.get().progress;
  store.subscribe(() => {
    const p = store.get().progress;
    if (p !== lastProgressRef) {
      lastProgressRef = p;
      const meta = readMeta(p.datasetId);
      const user = auth.get().user;
      if (!meta.owner && user) meta.owner = user.username;
      meta.localTs = Date.now();
      writeMeta(p.datasetId, meta);
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
