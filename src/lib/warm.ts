import type { Atlas, AudioKind } from "../atlas/types";
import { store } from "../store/store";

/**
 * Audio warming: downloads recordings into the service-worker media cache
 * BEFORE the learner taps play, so playback starts instantly. The SW serves
 * warmed files locally; warming a URL that is already cached costs no
 * network. Everything here is best-effort and silent on failure.
 */

const warmed = new Set<string>();
const queue: string[] = [];
let running = 0;
const CONCURRENCY = 4;

function pump() {
  while (running < CONCURRENCY && queue.length) {
    const url = queue.shift()!;
    running++;
    fetch(url)
      .catch(() => {})
      .finally(() => {
        running--;
        pump();
      });
  }
}

function enqueue(url: string | null) {
  if (!url || warmed.has(url)) return;
  warmed.add(url);
  queue.push(url);
}

/** Warm the recordings for a set of words: both word accents, plus each
 *  example in the accent chosen in settings (legacy single track as fallback). */
export function warmWords(atlas: Atlas, ids: Iterable<string>) {
  const accent = store.get().settings.accent;
  for (const id of ids) {
    const ref = atlas.byId.get(id);
    if (!ref) continue;
    enqueue(atlas.audio(ref, "uk"));
    enqueue(atlas.audio(ref, "us"));
    enqueue(atlas.audio(ref, `ex${accent}` as AudioKind) ?? atlas.audio(ref, "ex"));
    enqueue(atlas.audio(ref, `ex2${accent}` as AudioKind) ?? atlas.audio(ref, "ex2"));
  }
  pump();
}

const fullWarmed = new Set<string>();

/** Textbook-series atlases only: once the app has been open a while and the
 *  device is idle, quietly cache the whole book's audio (~25 MB) so every
 *  future tap is instant. Skipped on save-data / 2G connections. The IELTS
 *  atlas is far too large for this (hundreds of MB) and relies on
 *  per-session warming instead. */
export function scheduleFullWarm(atlas: Atlas) {
  if (atlas.series !== "pep" || fullWarmed.has(atlas.id)) return;
  fullWarmed.add(atlas.id);
  try {
    void navigator.storage?.persist?.();
  } catch {
    /* best effort */
  }
  const conn = (navigator as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (conn && (conn.saveData || conn.effectiveType === "slow-2g" || conn.effectiveType === "2g")) return;
  const start = () => warmWords(atlas, atlas.words.map((w) => w.id));
  window.setTimeout(() => {
    const ric = (window as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void }).requestIdleCallback;
    if (ric) ric(start, { timeout: 20000 });
    else start();
  }, 45000);
}
