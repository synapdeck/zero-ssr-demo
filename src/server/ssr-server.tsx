import {readFileSync} from 'node:fs';
import http from 'node:http';
import {Writable} from 'node:stream';
import {Zero, ZeroPool} from '@rocicorp/zero';
import {
  QuerySnapshotCollector,
  QuerySnapshotProvider,
  serializeQuerySnapshots,
  ZeroProvider,
} from '@rocicorp/zero/react';
import {renderToPipeableStream} from 'react-dom/server';
import {App} from '../app/app.tsx';
import {mutators, schema, type Context, type PageName} from '../app/schema.ts';

const CACHE_URL = `http://127.0.0.1:${process.env['CACHE_PORT']}`;
// Built next to this server, into dist/.
const BROWSER_JS = readFileSync(new URL('../browser.js', import.meta.url));

// One long-lived instance per user, which keeps their queries live between
// renders and is what a browser's client group can copy from.
const pool = new ZeroPool({
  create: userID =>
    new Zero({
      cacheURL: CACHE_URL,
      schema,
      mutators,
      userID,
      auth: `user:${userID}`,
      context: {userID} as Context,
      kvStore: 'mem',
      logLevel: 'error',
    }),
});

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
      const {html, snapshots} = await pool.use(user, zero =>
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
