/**
 * The saved list, kept in the reader's own browser.
 *
 * Every accessor is wrapped: a private window, blocked site data, or a
 * thumbnail renderer can all make localStorage throw on access rather than
 * merely return nothing, and a reading list is not worth breaking a page over.
 */

const KEY = "saved:v1";
const LIMIT = 200;

export function readSaved(): number[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((n): n is number => Number.isSafeInteger(n)) : [];
  } catch {
    return [];
  }
}

function write(ids: number[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids.slice(0, LIMIT)));
  } catch {
    /* nothing to do; the page still works without a saved list */
  }
}

export function isSaved(id: number): boolean {
  return readSaved().includes(id);
}

/** Adds or removes, returning whether the story is saved afterwards. */
export function toggleSaved(id: number): boolean {
  const ids = readSaved();
  const next = ids.includes(id) ? ids.filter((n) => n !== id) : [id, ...ids];
  write(next);
  return next.includes(id);
}

export function removeSaved(id: number): void {
  write(readSaved().filter((n) => n !== id));
}
