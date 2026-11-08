import type {QuerySnapshots} from '@rocicorp/zero/react';
import type {PageName} from './schema.ts';

declare global {
  interface Window {
    /** Set by the server's page. */
    __demo: {page: PageName; user: string; cacheURL: string};
    __seed: QuerySnapshots;
    /** Set by the browser bundle, for the benchmark to read. */
    __trace: string[];
    __recoverableErrors: string[];
    __liveAtMs?: number;
  }
}
