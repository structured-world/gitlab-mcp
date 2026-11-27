import type {
  WorkItem,
  WorkItemListFilter,
  WorkItemListFilterValues,
} from '../../graphql/workItems';

/** Filters the listing can evaluate itself from the widgets each listed item carries. */
export const LOCAL_LIST_FILTERS = [
  'assigneeUsernames',
  'labelName',
  'milestoneTitle',
  'parentIds',
] as const satisfies readonly WorkItemListFilter[];

export type LocalListFilter = (typeof LOCAL_LIST_FILTERS)[number];

export const isLocalListFilter = (name: WorkItemListFilter): name is LocalListFilter =>
  (LOCAL_LIST_FILTERS as readonly WorkItemListFilter[]).includes(name);

/** Upstream page size while filtering locally: GitLab's maximum page. */
export const SCAN_PAGE_SIZE = 100;

/** Upstream pages read per call before a short page is returned with a cursor. */
export const SCAN_PAGE_LIMIT = 10;

export interface ListConnection {
  nodes: WorkItem[];
  /** Per-item cursors; requested only when the listing filters locally. */
  edges?: Array<{ cursor: string }>;
  pageInfo: { hasNextPage: boolean; endCursor?: string | null };
}

export interface ScanResult extends ListConnection {
  /** Upstream items examined; reported when the page stays short with more to read. */
  scanned: number;
  /** Items left out because the deciding labels or assignees were beyond their first page. */
  unverified: number;
}

/** A first page of a widget connection, and whether GitLab holds more of it. */
interface WidgetPage<T> {
  nodes?: T[];
  pageInfo?: { hasNextPage: boolean };
}

/** Widget fields the local filters read; the listing selection requests all of them. */
interface FilterableWidget {
  type: string;
  assignees?: WidgetPage<{ username: string }>;
  labels?: WidgetPage<{ title: string }>;
  milestone?: { title: string } | null;
  parent?: { id: string } | null;
}

/** Outcome of one check; `unknown` when the deciding values are not in the listing. */
type Verdict = 'match' | 'miss' | 'unknown';

export type LocalListMatcher = (item: WorkItem) => Verdict;

const widget = (item: WorkItem, type: string): FilterableWidget | undefined =>
  (item.widgets as FilterableWidget[] | undefined)?.find((w) => w.type === type);

/**
 * Every wanted value is among the listed ones. A connection's first page is not the whole
 * set: when a value is absent there and GitLab has more, the item cannot be decided.
 */
function containsAll(wanted: readonly string[], page: WidgetPage<string> | undefined): Verdict {
  const have = new Set(page?.nodes);
  if (wanted.every((value) => have.has(value))) return 'match';
  return page?.pageInfo?.hasNextPage ? 'unknown' : 'miss';
}

/**
 * Predicate with GitLab's semantics for each filter: every listed assignee and label,
 * any listed milestone, any listed direct parent. Usernames compare case-insensitively,
 * as GitLab resolves them; label and milestone titles exactly.
 */
export function localListMatcher(
  values: Pick<WorkItemListFilterValues, LocalListFilter>,
): LocalListMatcher {
  const checks: Array<(item: WorkItem) => Verdict> = [];
  if (values.assigneeUsernames) {
    const wanted = values.assigneeUsernames.map((u) => u.toLowerCase());
    checks.push((item) => {
      const assignees = widget(item, 'ASSIGNEES')?.assignees;
      return containsAll(wanted, {
        nodes: assignees?.nodes?.map((u) => u.username.toLowerCase()),
        pageInfo: assignees?.pageInfo,
      });
    });
  }
  if (values.labelName) {
    const wanted = values.labelName;
    checks.push((item) => {
      const labels = widget(item, 'LABELS')?.labels;
      return containsAll(wanted, {
        nodes: labels?.nodes?.map((l) => l.title),
        pageInfo: labels?.pageInfo,
      });
    });
  }
  if (values.milestoneTitle) {
    const wanted = new Set(values.milestoneTitle);
    checks.push((item) => {
      const title = widget(item, 'MILESTONE')?.milestone?.title;
      return title !== undefined && wanted.has(title) ? 'match' : 'miss';
    });
  }
  if (values.parentIds) {
    const wanted = new Set(values.parentIds);
    checks.push((item) => {
      const id = widget(item, 'HIERARCHY')?.parent?.id;
      return id !== undefined && wanted.has(id) ? 'match' : 'miss';
    });
  }
  return (item) => {
    let verdict: Verdict = 'match';
    for (const check of checks) {
      const result = check(item);
      if (result === 'miss') return 'miss';
      if (result === 'unknown') verdict = 'unknown';
    }
    return verdict;
  };
}

/** A cursor GitLab must supply to continue; its absence breaks connection paging. */
function requireCursor(cursor: string | null | undefined, previous?: string): string {
  if (!cursor || cursor === previous) {
    throw new Error('GitLab returned a work item page without a cursor to continue from');
  }
  return cursor;
}

/**
 * Append the matching items of one upstream page until `nodes` holds `first`. Returns
 * the index of the item that filled the page (-1 if none) and the undecidable items.
 */
function collectMatches(
  upstream: WorkItem[],
  matcher: LocalListMatcher,
  first: number,
  nodes: WorkItem[],
): { filled: number; unverified: number } {
  let unverified = 0;
  for (let i = 0; i < upstream.length; i++) {
    const verdict = matcher(upstream[i]);
    if (verdict === 'unknown') unverified++;
    if (verdict === 'match' && nodes.push(upstream[i]) === first) return { filled: i, unverified };
  }
  return { filled: -1, unverified };
}

/**
 * Paging info of a page filled at `index`: more follows when the upstream page or
 * GitLab has more, and the next call resumes after that item from its own cursor.
 */
function filledPageInfo(connection: ListConnection, index: number): ListConnection['pageInfo'] {
  if (index + 1 === connection.nodes.length && !connection.pageInfo.hasNextPage) {
    return { hasNextPage: false, endCursor: null };
  }
  return { hasNextPage: true, endCursor: requireCursor(connection.edges?.[index]?.cursor) };
}

/**
 * Fill a page of `first` matching items by reading upstream pages in order and keeping
 * the items `matcher` accepts. Reading stops after SCAN_PAGE_LIMIT upstream pages, so a
 * sparse match costs a bounded number of requests per call; the short page then carries
 * a cursor to continue. Every returned cursor is GitLab's own, so a continuation resumes
 * after the last returned item even when items before it have changed. Returns null when
 * the first upstream request finds no owner.
 */
export async function scanWorkItems(
  fetchPage: (first: number, after?: string) => Promise<ListConnection | null>,
  matcher: LocalListMatcher,
  first: number,
  after: string | undefined,
): Promise<ScanResult | null> {
  let cursor = after;
  const nodes: WorkItem[] = [];
  let scanned = 0;
  let unverified = 0;
  const end = () => ({
    nodes,
    pageInfo: { hasNextPage: false, endCursor: null },
    scanned,
    unverified,
  });
  for (let page = 0; page < SCAN_PAGE_LIMIT; page++) {
    const connection = await fetchPage(SCAN_PAGE_SIZE, cursor);
    // The owner disappeared between requests: nothing further can be read.
    if (!connection) return page === 0 ? null : end();
    const collected = collectMatches(connection.nodes, matcher, first, nodes);
    unverified += collected.unverified;
    if (collected.filled >= 0) {
      scanned += collected.filled + 1;
      return { nodes, pageInfo: filledPageInfo(connection, collected.filled), scanned, unverified };
    }
    scanned += connection.nodes.length;
    if (!connection.pageInfo.hasNextPage) return end();
    cursor = requireCursor(connection.pageInfo.endCursor, cursor);
  }
  return { nodes, pageInfo: { hasNextPage: true, endCursor: cursor }, scanned, unverified };
}
