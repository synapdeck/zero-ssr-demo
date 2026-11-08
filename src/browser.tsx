/* oxlint-disable @typescript-eslint/no-explicit-any -- Demo code. */
import {hydrateRoot} from 'react-dom/client';
import {QuerySnapshotProvider} from 'zero-mono/packages/zero-react/src/query-snapshots.tsx';
import {ZeroProvider} from 'zero-mono/packages/zero-react/src/zero-provider.tsx';
import {Zero} from 'zero-mono/packages/zero/src/zero.ts';
import {App} from './app.tsx';
import {mutators, queries, schema} from './schema.ts';

const w = window as any;
const {page, user, cacheURL} = w.__demo;
const root = document.getElementById('root') as HTMLElement;

const text = () => root.textContent?.trim() || '(empty)';
w.__trace = [text()];
new MutationObserver(() => {
  if (w.__trace.at(-1) !== text()) {
    w.__trace.push(text());
  }
}).observe(root, {childList: true, subtree: true, characterData: true});

w.__recoverableErrors = [];
const zero = new Zero({
  cacheURL,
  schema,
  mutators,
  userID: user,
  auth: `user:${user}`,
  context: {userID: user},
} as any);

// A second view of the same query shares its pipeline, so this only observes.
const view = zero.materialize((queries as any)[page]());
view.addListener((_data: unknown, type: string) => {
  if (type === 'complete' && w.__liveAtMs === undefined) {
    w.__liveAtMs = performance.now();
  }
});

hydrateRoot(
  root,
  <ZeroProvider zero={zero as any}>
    <QuerySnapshotProvider snapshots={w.__seed}>
      <App page={page} />
    </QuerySnapshotProvider>
  </ZeroProvider>,
  {
    onRecoverableError: e =>
      w.__recoverableErrors.push(String((e as Error).message)),
  },
);
w.__hydratedAtMs = performance.now();
