import {useQuery} from '@rocicorp/zero/react';
import {Suspense} from 'react';
import {queries, type PageName} from './schema.ts';

function Rows({rows, type}: {rows: readonly {id: string}[]; type: string}) {
  return (
    <main data-type={type}>
      <ul>
        {rows.slice(0, 5).map(row => (
          <li key={row.id}>{row.id}</li>
        ))}
      </ul>
    </main>
  );
}

function Search() {
  const [rows, details] = useQuery(queries.search());
  return <Rows rows={rows} type={details.type} />;
}

function List() {
  const [rows, details] = useQuery(queries.list());
  return <Rows rows={rows} type={details.type} />;
}

function Thread() {
  const [rows, details] = useQuery(queries.thread());
  return <Rows rows={rows} type={details.type} />;
}

function Total() {
  const [count, details] = useQuery(queries.total());
  return (
    <main data-type={details.type}>
      <output>{String(count)}</output>
    </main>
  );
}

const PAGES = {search: Search, list: List, thread: Thread, total: Total};

export function App({page}: {page: PageName}) {
  const Page = PAGES[page];
  return (
    <Suspense fallback={<i>loading</i>}>
      <Page />
    </Suspense>
  );
}
