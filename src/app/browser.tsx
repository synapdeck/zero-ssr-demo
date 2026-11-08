import {Zero} from '@rocicorp/zero';
import {QuerySnapshotProvider, ZeroProvider} from '@rocicorp/zero/react';
import {hydrateRoot} from 'react-dom/client';
import {App} from './app.tsx';
import {mutators, queries, schema, type Context} from './schema.ts';

const {page, user, cacheURL} = window.__demo;
const root = document.getElementById('root')!;

// Every distinct text the page shows, so that the benchmark can spot an empty
// flash and see live updates arrive.
const text = () => root.textContent?.trim() || '(empty)';
window.__trace = [text()];
new MutationObserver(() => {
  if (window.__trace.at(-1) !== text()) {
    window.__trace.push(text());
  }
}).observe(root, {childList: true, subtree: true, characterData: true});
window.__recoverableErrors = [];

const zero = new Zero({
  cacheURL,
  schema,
  mutators,
  userID: user,
  auth: `user:${user}`,
  context: {userID: user} as Context,
});

// A second view of the same query shares its pipeline, so this only observes.
const onResult = (_data: unknown, type: string) => {
  if (type === 'complete' && window.__liveAtMs === undefined) {
    window.__liveAtMs = performance.now();
  }
};
({
  search: () => zero.materialize(queries.search()).addListener(onResult),
  list: () => zero.materialize(queries.list()).addListener(onResult),
  thread: () => zero.materialize(queries.thread()).addListener(onResult),
  total: () => zero.materialize(queries.total()).addListener(onResult),
})[page]();

hydrateRoot(
  root,
  <ZeroProvider zero={zero}>
    <QuerySnapshotProvider snapshots={window.__seed}>
      <App page={page} />
    </QuerySnapshotProvider>
  </ZeroProvider>,
  {
    onRecoverableError: e =>
      window.__recoverableErrors.push(String((e as Error).message)),
  },
);
