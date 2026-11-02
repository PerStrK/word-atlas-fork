import { useSyncExternalStore } from "react";
import type { Atlas, Entry, WordRef } from "../atlas/types";
import { MEDIA } from "../atlas/types";
import { apiGet, auth } from "./auth";

/**
 * The reading-space 生词本 as a permanent, per-user private atlas.
 *
 * The server reads the reading-space vocab table live (GET /api/vocab) and
 * returns fully-formed entries, borrowing rich content from the library
 * datasets where a word exists there. This set is NOT a switchable dataset:
 * it sits beside whichever dataset is active, and words learned here land in
 * the same shared pool (cards are keyed by word), so a star lit here stays
 * lit in every dataset.
 */
export const VOCAB_ID = "reading-vocab";

interface VocabWord {
  id: string;
  word: string;
  zh: string;
  ipa: string;
  cefr: string;
  topic: string;
  media: number;
  entry: Entry;
}

interface VocabPayload {
  id: string;
  name: string;
  topics: [string, string][];
  words: VocabWord[];
}

export function buildVocabAtlas(payload: VocabPayload): Atlas {
  const topics: [string, string][] = payload.topics?.length
    ? payload.topics
    : [["daily", "日常"]];
  const topicIdx = new Map(topics.map((t, i) => [t[0], i] as const));
  const cefrNames: string[] = [];
  const cefrIdx = new Map<string, number>();
  const entries = new Map<string, Entry>();
  const words: WordRef[] = (payload.words ?? []).map((w, order) => {
    entries.set(w.id, w.entry);
    if (!cefrIdx.has(w.cefr)) {
      cefrIdx.set(w.cefr, cefrNames.length);
      cefrNames.push(w.cefr);
    }
    return {
      id: w.id,
      word: w.word,
      zh: w.zh,
      ipa: w.ipa,
      cefr: cefrIdx.get(w.cefr)!,
      topic: topicIdx.get(w.topic) ?? 0,
      media: w.media,
      order,
    };
  });
  const byId = new Map(words.map((w) => [w.id, w]));
  return {
    id: VOCAB_ID,
    name: payload.name || "生词本",
    kind: "private",
    count: words.length,
    examples: [...entries.values()].reduce((n, e) => n + e.ex.length, 0),
    illustrated: words.filter((w) => w.media & MEDIA.img).length,
    topics,
    cefr: cefrNames.length ? cefrNames : ["生词"],
    words,
    byId,
    peek: (id) => entries.get(id),
    entry: async (id) => {
      const e = entries.get(id);
      if (!e) throw new Error(`没有找到词条 ${id}`);
      return e;
    },
    img: (ref) => entries.get(ref.id)?.media?.img ?? null,
    audio: (ref, kind) => entries.get(ref.id)?.media?.[kind] ?? null,
  };
}

let atlas: Atlas | null = null;
let loadedFor: string | null = null;
let loading = false;
let snapshot: { atlas: Atlas | null } = { atlas: null };
const listeners = new Set<() => void>();

function emit() {
  snapshot = { atlas };
  listeners.forEach((l) => l());
}

export async function refreshVocab(force = false): Promise<void> {
  const user = auth.get().user;
  if (!user) return;
  if (loading) return;
  if (!force && loadedFor === user.username && atlas) return;
  loading = true;
  try {
    const d = (await apiGet("/vocab")) as VocabPayload;
    atlas = buildVocabAtlas(d);
    loadedFor = user.username;
  } catch {
    /* keep whatever we had; the panel simply stays as it was */
  } finally {
    loading = false;
    emit();
  }
}

export function useVocabAtlas(): Atlas | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => snapshot,
    () => snapshot,
  ).atlas;
}

// Follow the signed-in account: fetch on login, clear on logout/switch.
auth.subscribe(() => {
  const u = auth.get().user;
  if (!u) {
    if (atlas || loadedFor) {
      atlas = null;
      loadedFor = null;
      emit();
    }
  } else if (loadedFor !== u.username) {
    void refreshVocab(true);
  }
});
