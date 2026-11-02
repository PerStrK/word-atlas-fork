import { useSyncExternalStore } from "react";
import { apiGet, apiPut, auth } from "./auth";

export interface DatasetInfo {
  id: string;
  name: string;
  desc: string;
  root: string;
  count: number;
}

export const DEFAULT_DATASET = "pep-g7s1-atlas";
const FALLBACK: DatasetInfo[] = [
  { id: DEFAULT_DATASET, name: "人教版七上", desc: "教学词库 · 七年级上册课本词", root: "atlas", count: 423 },
];
const LS_ENABLED = "word-atlas:enabled-datasets";
const LS_ACTIVE = "word-atlas:active-dataset";

function readIds(key: string): string[] | null {
  try {
    const v = JSON.parse(localStorage.getItem(key) || "null");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : null;
  } catch {
    return null;
  }
}

let list: DatasetInfo[] = FALLBACK;
let enabled: string[] = readIds(LS_ENABLED) ?? [DEFAULT_DATASET];
let active: string = localStorage.getItem(LS_ACTIVE) || DEFAULT_DATASET;
let ready = false;
let snapshot = { list, enabled, active, ready };
const listeners = new Set<() => void>();

function emit() {
  snapshot = { list, enabled, active, ready };
  listeners.forEach((l) => l());
}

function persistLocal() {
  try {
    localStorage.setItem(LS_ENABLED, JSON.stringify(enabled));
    localStorage.setItem(LS_ACTIVE, active);
  } catch {
    /* ignore */
  }
}

function normalize() {
  const known = new Set(list.map((d) => d.id));
  enabled = enabled.filter((id) => known.has(id));
  if (!enabled.length) enabled = [list[0].id];
  if (!enabled.includes(active)) active = enabled[0];
}

export const datasetsStore = {
  get: () => snapshot,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

export function useDatasets() {
  return useSyncExternalStore(datasetsStore.subscribe, datasetsStore.get, datasetsStore.get);
}

export function datasetById(id: string): DatasetInfo | undefined {
  return list.find((d) => d.id === id);
}

let initPromise: Promise<void> | null = null;

export function initDatasets(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      try {
        const d = await apiGet("/datasets");
        if (Array.isArray(d.datasets) && d.datasets.length) list = d.datasets as DatasetInfo[];
      } catch {
        /* keep fallback list */
      }
      normalize();
      ready = true;
      persistLocal();
      emit();
    })();
  }
  return initPromise;
}

/** After login: the account's saved dataset selection wins over the local one. */
export async function applyServerPrefs() {
  if (!auth.get().user) return;
  await initDatasets();
  try {
    const d = await apiGet("/user/prefs");
    if (Array.isArray(d.datasets) && d.datasets.length) {
      enabled = d.datasets as string[];
      normalize();
      persistLocal();
      emit();
    }
  } catch {
    /* keep local selection */
  }
}

export function setEnabled(ids: string[]) {
  enabled = ids;
  normalize();
  persistLocal();
  emit();
  if (auth.get().user) {
    void apiPut("/user/prefs", { datasets: enabled }).catch(() => {
      /* will re-apply on next login */
    });
  }
}

export function setActive(id: string) {
  if (!enabled.includes(id) || id === active) return;
  active = id;
  persistLocal();
  emit();
}
