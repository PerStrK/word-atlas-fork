import type { Atlas, WordRef} from "../atlas/types";
import { datasetsStore} from "./datasets";
import { normalize, wordKey} from "./text";
import { store, type Progress} from "../store/store";

/**
* Sense-level subdivision of "learned".
*
* A card in the shared pool says the WORD was learned. But the same word can
* carry new senses in a later book of the same series (七下 vs 七上): those
* senses were never learned, so the word must not count as fully learned
* there. Each dataset belongs to a series (textbook series share one; other
* datasets are their own series). Per word we remember which
* sense-signatures have been covered in each series; a signature is the
* dataset index's gloss text, normalized. A learned word whose signature in
* the active dataset's series is not covered is "sense-new": it re-enters
* the learning path as a top-up (intro + quiz, with this dataset's gloss as
* the correct answers) while keeping its FSRS card and its star.
*/
export function senseSig(zh: string): string {
return normalize(zh).replace(/[\s，。；：、·.,;:!?'"“”‘’()（）]/g, "");
}

export const senseTag = (series: string, zh: string) => `${series}:${senseSig(zh)}`;

/** True when this dataset's senses for the word are on record as covered. */
export function senseCoveredBy(senses: Progress["senses"], series: string | undefined, ref: WordRef): boolean {
if (!series) return true;
const tags = senses?.[wordKey(ref.word)];
if (!tags) return true; // no record yet: baseline (see below) is the default
return tags.includes(senseTag(series, ref.zh));
}

export function senseCovered(p: Progress, series: string | undefined, ref: WordRef): boolean {
return senseCoveredBy(p.senses, series, ref);
}

/** Learned as a word, but this dataset's senses are new to the learner. */
export function isSenseNew(atlas: Atlas, p: Progress, ref: WordRef): boolean {
if (!atlas.series) return false;
if (!p.cards[wordKey(ref.word)]) return false;
const tags = p.senses?.[wordKey(ref.word)];
if (!tags) return false; // pre-feature pool: baseline applies, no flood of top-ups
return!tags.includes(senseTag(atlas.series, ref.zh));
}

let tagsCache: Promise<Map<string, string[]>> | null = null;

/** wordKey -> coverage tags from every current dataset's index gloss. */
function allDatasetTags(): Promise<Map<string, string[]>> {
if (!tagsCache) {
tagsCache = (async () => {
const out = new Map<string, string[]>();
for (const info of datasetsStore.get().list) {
const series = info.series?? info.id;
try {
const r = await fetch(`${import.meta.env.BASE_URL}${info.root}/index.json`);
if (!r.ok) continue;
const idx = (await r.json()) as { fields?: string[]; words?: unknown[][]};
const wi = idx.fields?.indexOf("word")?? 1;
const zi = idx.fields?.indexOf("zh")?? 2;
for (const row of idx.words?? []) {
const w = row[wi];
const zh = row[zi];
if (typeof w!== "string" || typeof zh!== "string") continue;
const k = wordKey(w);
const tag = senseTag(series, zh);
const arr = out.get(k)?? [];
if (!arr.includes(tag)) arr.push(tag);
out.set(k, arr);
}
} catch {
/* a dataset that fails to load simply contributes nothing */
}
}
return out;
})();
}
return tagsCache;
}

/**
* One-time baseline for pools learned before sense tracking existed: every
* word that already has a card is credited with the signatures of all
* CURRENT datasets, so only genuinely new senses (a future book, an edited
* gloss) trigger top-ups. Fills missing records only; safe to call again.
*/
export async function ensureSenseBaseline(): Promise<void> {
const p = store.get().progress;
const keys = Object.keys(p.cards);
if (!keys.length) return;
if (keys.every((k) => p.senses?.[k]?.length)) return;
const tags = await allDatasetTags();
store.progress((cur) => {
const senses = {...(cur.senses?? {})};
let changed = false;
for (const k of Object.keys(cur.cards)) {
if (!senses[k]?.length) {
const t = tags.get(k);
if (t?.length) {
senses[k] = [...t];
changed = true;
}
}
}
return changed? {...cur, senses}: cur;
});
}
