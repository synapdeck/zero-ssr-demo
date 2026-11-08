/* oxlint-disable @typescript-eslint/no-explicit-any -- Demo code. */
import {Suspense} from 'react';
import {useQuery} from 'zero-mono/packages/zero-react/src/use-query.tsx';
import {queries, type PageName} from './schema.ts';

function Page({page}: {page: PageName}) {
  const [result, details] = useQuery((queries as any)[page]());
  const rows = result as unknown;
  return (
    <main data-type={details.type}>
      {Array.isArray(rows) ? (
        <ul>
          {rows.slice(0, 5).map(row => (
            <li key={row.id}>{row.id}</li>
          ))}
        </ul>
      ) : (
        <output>{String(rows)}</output>
      )}
    </main>
  );
}

export function App({page}: {page: PageName}) {
  return (
    <Suspense fallback={<i>loading</i>}>
      <Page page={page} />
    </Suspense>
  );
}
