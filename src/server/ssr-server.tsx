import {readFileSync} from 'node:fs';
import http from 'node:http';
import {Writable} from 'node:stream';
import {Zero} from '@rocicorp/zero';
import {
  QuerySnapshotCollector,
  QuerySnapshotProvider,
  serializeQuerySnapshots,
  ZeroProvider,
} from '@rocicorp/zero/react';
import {renderToPipeableStream} from 'react-dom/server';
import {App} from '../app/app.tsx';
import {mutators, schema, type Context, type PageName} from '../app/schema.ts';
import {ZeroPool} from './zero-pool.ts';

const CACHE_URL = `http://127.0.0.1:${process.env['CACHE_PORT']}`;
// Built next to this server, into dist/.
const BROWSER_JS = readFileSync(new URL('../browser.js', import.meta.url));

const createZero = (userID: string, storageKey?: string) =>
  new Zero({
    cacheURL: CACHE_URL,
    schema,
    mutators,
    userID,
    auth: `user:${userID}`,
    context: {userID} as Context,
    storageKey,
    kvStore: 'mem',
    logLevel: 'error',
  });

/**
 * How the server gets a Zero instance for a render:
 *
 * - `pool`: one long-lived instance per user, which keeps their queries live
 *   between renders.
 * - `per-request`: a new instance per request, closed after rendering. Its
 *   in-memory store outlives it, so the next one for the user reuses its
 *   client group.
 * - `fresh`: a new instance and client group per request.
 */
const MODE = process.env['SSR_ZERO'] ?? 'pool';
const pool = new ZeroPool(userID => createZero(userID));
let fresh = 0;

async function withZero<T>(
  userID: string,
  fn: (zero: Zero<typeof schema>) => Promise<T>,
): Promise<T> {
  if (MODE === 'pool') {
    return fn(pool.get(userID));
  }
  const zero = createZero(
    userID,
    MODE === 'fresh' ? `fresh${fresh++}` : undefined,
  );
  try {
    return await fn(zero);
  } finally {
    await zero.close();
  }
}

function render(zero: Zero<typeof schema>, page: PageName) {
  const collector = new QuerySnapshotCollector();
  return new Promise<{html: string; snapshots: string}>((resolve, reject) => {
    let html = '';
    const out = new Writable({
      write(chunk, _encoding, callback) {
        html += chunk;
        callback();
      },
    });
    out.on('finish', () =>
      resolve({html, snapshots: serializeQuerySnapshots(collector.toJSON())}),
    );
    const stream = renderToPipeableStream(
      <ZeroProvider zero={zero}>
        <QuerySnapshotProvider collector={collector}>
          <App page={page} />
        </QuerySnapshotProvider>
      </ZeroProvider>,
      {onAllReady: () => stream.pipe(out), onShellError: reject},
    );
    setTimeout(() => stream.abort(new Error('render timeout')), 20_000).unref();
  });
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url ?? '', 'http://unused/');
    if (url.pathname === '/browser.js') {
      res.writeHead(200, {'content-type': 'text/javascript'});
      res.end(BROWSER_JS);
      return;
    }
    const page = (url.searchParams.get('page') ?? 'search') as PageName;
    const user = url.searchParams.get('user') ?? 'alice';
    const start = performance.now();
    try {
      const {html, snapshots} = await withZero(user, zero =>
        render(zero, page),
      );
      res.writeHead(200, {
        'content-type': 'text/html',
        'x-render-ms': (performance.now() - start).toFixed(1),
      });
      res.end(
        `<!doctype html><html><body><div id="root">${html}</div>` +
          `<script>window.__demo=${JSON.stringify({page, user, cacheURL: CACHE_URL})};` +
          `window.__seed=${snapshots}</script>` +
          `<script src="/browser.js"></script></body></html>`,
      );
    } catch (e) {
      res.writeHead(500);
      res.end(String(e));
    }
  })
  .listen(Number(process.env['SSR_PORT']), '127.0.0.1');
