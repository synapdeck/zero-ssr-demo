import {
  createBuilder,
  createSchema,
  defineMutators,
  defineQueries,
  defineQuery,
  number,
  relationships,
  string,
  table,
} from 'zero-mono/packages/zero/src/zero.ts';

const issue = table('issue')
  .columns({id: string(), title: string(), owner: string(), rank: number()})
  .primaryKey('id');
const comment = table('comment')
  .columns({id: string(), issueID: string(), body: string()})
  .primaryKey('id');

const issueRelationships = relationships(issue, ({many}) => ({
  comments: many({
    sourceField: ['id'],
    destField: ['issueID'],
    destSchema: comment,
  }),
}));
const commentRelationships = relationships(comment, ({one}) => ({
  issue: one({sourceField: ['issueID'], destField: ['id'], destSchema: issue}),
}));

export const schema = createSchema({
  tables: [issue, comment],
  relationships: [issueRelationships, commentRelationships],
});
export const mutators = defineMutators({});

const builder = createBuilder(schema);

export type Context = {userID: string} | undefined;

const mine = (ctx: Context) =>
  builder.issue.where('owner', ctx?.userID ?? 'public');
const matching = (ctx: Context) =>
  mine(ctx).whereExists('comments', c => c.where('body', 'LIKE', '%needle%'));
const threadOf = (issueID: string) =>
  defineQuery(() =>
    builder.comment
      .whereExists('issue', q => q.where('id', issueID), {scalar: true})
      .orderBy('id', 'asc'),
  );

/**
 * One query per kind of page. Row visibility comes from the context, which the
 * API server derives from the token, as a real app's would.
 */
export const queries = defineQueries({
  // Reads every issue the user owns to return a handful: nearly all hydration.
  search: defineQuery(({ctx}: {ctx: Context}) =>
    matching(ctx).orderBy('rank', 'asc').limit(5),
  ),
  // Returns everything it reads: mostly reading and writing rows, not hydration.
  list: defineQuery(({ctx}: {ctx: Context}) =>
    mine(ctx).orderBy('rank', 'asc').limit(1000).related('comments'),
  ),
  // A scalar subquery, resolved while the pipeline is built.
  thread: threadOf('i5'),
  threadChanging: threadOf('i10'),
  // An aggregate, which can't be copied yet and always hydrates.
  total: defineQuery(({ctx}: {ctx: Context}) => matching(ctx).count()),
});

export type PageName = 'search' | 'list' | 'thread' | 'total';
export const PAGES: readonly PageName[] = ['search', 'list', 'thread', 'total'];
