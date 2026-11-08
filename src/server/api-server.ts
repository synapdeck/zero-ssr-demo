import http from 'node:http';
import {mustGetQuery} from '@rocicorp/zero';
import {handleQueryRequest} from '@rocicorp/zero/server';
import {queries, schema} from '../app/schema.ts';

const BEARER_USER = /^Bearer user:(\w+)$/;

/** The app's query endpoint, which zero-cache calls to resolve named queries. */
http
  .createServer(async (req, res) => {
    const url = new URL(req.url ?? '', 'http://unused/');
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
    }
    const match = BEARER_USER.exec(req.headers.authorization ?? '');
    const ctx = match ? {userID: match[1]} : undefined;
    const body = await handleQueryRequest({
      handler: (name, args) => mustGetQuery(queries, name).fn({args, ctx}),
      schema,
      query: Object.fromEntries(url.searchParams),
      body: JSON.parse(raw || 'null'),
      userID: ctx?.userID,
      logLevel: 'error',
    });
    res.writeHead(200, {'content-type': 'application/json'});
    res.end(JSON.stringify(body));
  })
  .listen(Number(process.env['API_PORT']), '127.0.0.1');
