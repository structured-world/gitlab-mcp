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
  pageInfo: { hasNextPage: boolean; endCursor?: string | null };
}

export interface ScanResult extends ListConnection {
  /** Upstream items examined; reported when the page stays short with more to read. */
  scanned: number;
}

/** Widget fields the local filters read; the listing selection requests all of them. */
interface FilterableWidget {
  type: string;
  assignees?: { nodes?: Array<{ username: string }> };
  labels?: { nodes?: Array<{ title: string }> };
  milestone?: { title: string } | null;
  parent?: { id: string } | null;
}

const widget = (item: WorkItem, type: string): FilterableWidget | undefined =>
  (item.widgets as FilterableWidget[] | undefined)?.find((w) => w.type === type);

/**
 * Predicate with GitLab's semantics for each filter: every listed assignee and label,
 * any listed milestone, any listed direct parent. Usernames compare case-insensitively,
 * as GitLab resolves them; label and milestone titles exactly.
 */
export function localListMatcher(
  values: Pick<WorkItemListFilterValues, LocalListFilter>,
): (item: WorkItem) => boolean {
  const checks: Array<(item: WorkItem) => boolean> = [];
  if (values.assigneeUsernames) {
    const wanted = values.assigneeUsernames.map((u) => u.toLowerCase());
    checks.push((item) => {
      const have = new Set(
        widget(item, 'ASSIGNEES')?.assignees?.nodes?.map((u) => u.username.toLowerCase()),
      );
      return wanted.every((u) => have.has(u));
    });
  }
  if (values.labelName) {
    const wanted = values.labelName;
    checks.push((item) => {
      const have = new Set(widget(item, 'LABELS')?.labels?.nodes?.map((l) => l.title));
      return wanted.every((title) => have.has(title));
    });
  }
  if (values.milestoneTitle) {
    const wanted = new Set(values.milestoneTitle);
    checks.push((item) => {
      const title = widget(item, 'MILESTONE')?.milestone?.title;
      return title !== undefined && wanted.has(title);
    });
  }
  if (values.parentIds) {
    const wanted = new Set(values.parentIds);
    checks.push((item) => {
      const id = widget(item, 'HIERARCHY')?.parent?.id;
      return id !== undefined && wanted.has(id);
    });
  }
  return (item) => checks.every((check) => check(item));
}

const CURSOR_PREFIX = 'scan:';

interface ScanPosition {
  /** Upstream cursor of the page holding the next item; absent for the first page. */
  after?: string;
  /** Items of that page already returned. */
  skip: number;
}

/**
 * A page can end inside an upstream page, so the cursor carries the upstream cursor
 * plus how many of its items were already returned. A plain GitLab cursor starts at
 * the beginning of its page.
 */
function encodeCursor({ after, skip }: ScanPosition): string {
  return CURSOR_PREFIX + Buffer.from(JSON.stringify({ after, skip })).toString('base64url');
}

function decodeCursor(cursor: string | undefined): ScanPosition {
  if (!cursor?.startsWith(CURSOR_PREFIX)) return { after: cursor, skip: 0 };
  try {
    const raw: unknown = JSON.parse(
      Buffer.from(cursor.slice(CURSOR_PREFIX.length), 'base64url').toString('utf8'),
    );
    if (raw && typeof raw === 'object') {
      const { after, skip } = raw as Record<string, unknown>;
      if (
        (after === undefined || typeof after === 'string') &&
        Number.isInteger(skip) &&
        (skip as number) >= 0 &&
        (skip as number) < SCAN_PAGE_SIZE
      ) {
        return { after, skip: skip as number };
      }
    }
  } catch {
    // Reported below with the other malformed cursors.
  }
  throw new Error('Invalid "after" cursor: pass the endCursor returned by the previous page');
}

/**
 * Append the matching items of one upstream page, from `skip`, until `nodes` holds
 * `first`. Returns the index of the item that filled the page, or -1.
 */
function collectMatches(
  upstream: WorkItem[],
  skip: number,
  matches: (item: WorkItem) => boolean,
  first: number,
  nodes: WorkItem[],
): number {
  for (let i = skip; i < upstream.length; i++) {
    if (matches(upstream[i]) && nodes.push(upstream[i]) === first) return i;
  }
  return -1;
}

/** Paging info of a page filled at `index` of the upstream page read from `position`. */
function filledPageInfo(
  connection: ListConnection,
  position: ScanPosition,
  index: number,
): ListConnection['pageInfo'] {
  if (index + 1 < connection.nodes.length) {
    return {
      hasNextPage: true,
      endCursor: encodeCursor({ after: position.after, skip: index + 1 }),
    };
  }
  const { hasNextPage, endCursor } = connection.pageInfo;
  return { hasNextPage, endCursor: hasNextPage ? endCursor : null };
}

/**
 * Fill a page of `first` matching items by reading upstream pages in order and keeping
 * the items `matches` accepts. Reading stops after SCAN_PAGE_LIMIT upstream pages, so a
 * sparse match costs a bounded number of requests per call; the short page then carries
 * a cursor to continue. Returns null when the first upstream request finds no owner.
 */
export async function scanWorkItems(
  fetchPage: (first: number, after?: string) => Promise<ListConnection | null>,
  matches: (item: WorkItem) => boolean,
  first: number,
  after: string | undefined,
): Promise<ScanResult | null> {
  let position = decodeCursor(after);
  const nodes: WorkItem[] = [];
  let scanned = 0;
  for (let page = 0; page < SCAN_PAGE_LIMIT; page++) {
    const connection = await fetchPage(SCAN_PAGE_SIZE, position.after);
    // The owner disappeared between requests: nothing further can be read.
    if (!connection) {
      if (page === 0) return null;
      return { nodes, pageInfo: { hasNextPage: false, endCursor: null }, scanned };
    }
    const filled = collectMatches(connection.nodes, position.skip, matches, first, nodes);
    if (filled >= 0) {
      scanned += filled + 1 - position.skip;
      return { nodes, pageInfo: filledPageInfo(connection, position, filled), scanned };
    }
    scanned += Math.max(0, connection.nodes.length - position.skip);
    const { hasNextPage, endCursor } = connection.pageInfo;
    if (!hasNextPage || !endCursor) {
      return { nodes, pageInfo: { hasNextPage: false, endCursor: null }, scanned };
    }
    position = { after: endCursor, skip: 0 };
  }
  return {
    nodes,
    pageInfo: { hasNextPage: true, endCursor: encodeCursor(position) },
    scanned,
  };
}
