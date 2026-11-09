import {dropDatabase, type Zero} from '@rocicorp/zero';

type Entry<Z> = {zero: Z; timer?: NodeJS.Timeout};

/**
 * One long-lived Zero instance per user, so that their queries stay live
 * between renders instead of hydrating again on every request. An instance
 * unused for `idleMs` is closed, and its in-memory store, which outlives
 * `close()`, is dropped.
 *
 * Each instance acts as the user it was created for, so the key must be the
 * authenticated user, never something taken from the request unchecked.
 */
export class ZeroPool<Z extends Zero> {
  readonly #entries = new Map<string, Entry<Z>>();
  readonly #create: (userID: string) => Z;
  readonly #idleMs: number;

  constructor(create: (userID: string) => Z, idleMs = 5 * 60_000) {
    this.#create = create;
    this.#idleMs = idleMs;
  }

  get(userID: string): Z {
    let entry = this.#entries.get(userID);
    if (!entry) {
      entry = {zero: this.#create(userID)};
      this.#entries.set(userID, entry);
    }
    clearTimeout(entry.timer);
    const e = entry;
    e.timer = setTimeout(() => this.#evict(userID, e), this.#idleMs);
    e.timer.unref();
    return e.zero;
  }

  async #evict(userID: string, entry: Entry<Z>) {
    this.#entries.delete(userID);
    await entry.zero.close();
    await dropDatabase(entry.zero.idbName, {kvStore: 'mem'});
  }
}
