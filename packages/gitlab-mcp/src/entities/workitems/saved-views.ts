import type { GraphQLClient } from '../../graphql/client';
import {
  GET_FILTERABLE_WORK_ITEM_TYPES,
  GET_SAVED_VIEW,
  LIST_SAVED_VIEWS,
  SAVED_VIEW_ARG_TYPES,
  savedViewItemsQuery,
  type FilterableTypes,
  type SavedViewDetail,
  type SavedViewNode,
} from '../../graphql/savedViews';
import type { WorkItem } from '../../graphql/workItems';
import { graphqlSupports } from '../instance-version';
import { extractSimpleId } from '../../utils/idConversion';

const SAVED_VIEW_GID_PREFIX = 'gid://gitlab/WorkItems::SavedViews::SavedView/';

const upper = (value: string): string => value.toUpperCase();

/** Health statuses are camelCase names over snake_case values; NONE and ANY are not. */
const healthStatusName = (value: string): string =>
  /^(none|any)$/i.test(value)
    ? upper(value)
    : value.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

type EnumRule = { enum: string; name: (value: string) => string };

/**
 * GitLab stores a view's enum filters by their internal values, not by the names its
 * GraphQL schema accepts: `issue` for `ISSUE`, `on_track` for `onTrack`. Each enum
 * filter, keyed by its argument or input field name, with its enum and the rule back
 * to the name. The negated and unioned inputs reuse these, except where
 * NEGATED_ENUM_FILTERS names another enum.
 */
const ENUM_FILTERS: Readonly<Record<string, EnumRule>> = {
  types: { enum: 'IssueType', name: upper },
  in: { enum: 'IssuableSearchableField', name: upper },
  subscribed: { enum: 'SubscriptionStatus', name: upper },
  state: { enum: 'IssuableState', name: (value) => value },
  sort: { enum: 'WorkItemSort', name: (value) => value },
  healthStatusFilter: { enum: 'HealthStatusFilter', name: healthStatusName },
  assigneeWildcardId: { enum: 'AssigneeWildcardId', name: upper },
  milestoneWildcardId: { enum: 'MilestoneWildcardId', name: upper },
  releaseTagWildcardId: { enum: 'ReleaseTagWildcardId', name: upper },
  iterationWildcardId: { enum: 'IterationWildcardId', name: upper },
  weightWildcardId: { enum: 'WeightWildcardId', name: upper },
  parentWildcardId: { enum: 'WorkItemParentWildcardId', name: upper },
};

const NEGATED_ENUM_FILTERS: Readonly<Record<string, EnumRule>> = {
  milestoneWildcardId: { enum: 'NegatedMilestoneWildcardId', name: upper },
  healthStatusFilter: { enum: 'HealthStatus', name: healthStatusName },
};

/** Named type under the list and non-null wrappers of a variable type. */
const baseType = (type: string): string => type.replace(/[[\]!]/g, '');

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The value GitLab accepts for an enum filter, or undefined when this instance's enum
 * has no such value. `parent` is the input object holding the field, if any.
 */
function enumValue(field: string, value: unknown, parent?: string): unknown {
  const rule = (parent === 'not' && NEGATED_ENUM_FILTERS[field]) || ENUM_FILTERS[field];
  if (!rule) return value;
  const convert = (one: unknown): string | undefined => {
    if (typeof one !== 'string') return undefined;
    const name = rule.name(one);
    return graphqlSupports(rule.enum, name) ? name : undefined;
  };
  if (Array.isArray(value)) {
    const names = value.map(convert);
    return names.every((name) => name !== undefined) ? names : undefined;
  }
  return convert(value);
}

/**
 * The fields of an input object filter the instance accepts, with enum values
 * converted. Fields it lacks are reported by their path and left out.
 */
function inputValue(
  type: string,
  value: Record<string, unknown>,
  path: string,
  unapplied: string[],
): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  for (const [field, raw] of Object.entries(value)) {
    if (raw === null || raw === undefined) continue;
    const converted = graphqlSupports(type, field) ? enumValue(field, raw, path) : undefined;
    if (converted === undefined) unapplied.push(`${path}.${field}`);
    else kept[field] = converted;
  }
  return kept;
}

/** How a saved view's items are read: where, with which arguments, and what was left out. */
export interface ViewQueryPlan {
  namespacePath: string;
  args: Record<string, unknown>;
  /** Filters (by path, such as `not.types`) this instance cannot apply; omitting them broadens the result. */
  unapplied: string[];
}

/**
 * Turn a saved view's stored filters and sort into `Namespace.workItems` arguments,
 * the way GitLab's work item list applies them: a `fullPath` filter lists that
 * group's own items, otherwise items of descendant groups and projects are included,
 * and no state filter means every state. Filters the instance cannot take are listed
 * as unapplied instead of failing the query.
 */
export function planViewQuery(
  namespacePath: string,
  filters: Record<string, unknown>,
  sort: string | null,
): ViewQueryPlan {
  const { fullPath, ...stored } = filters;
  const scoped = typeof fullPath === 'string' && fullPath.length > 0;
  const defaults: Record<string, unknown> = scoped
    ? { includeDescendants: false, excludeProjects: true }
    : { includeDescendants: true };
  const args: Record<string, unknown> = {};
  const unapplied: string[] = [];

  const apply = (field: string, stored: unknown, fromView: boolean) => {
    // An empty input object (`not: {}`) filters nothing.
    if (stored === null || stored === undefined) return;
    if (isPlainObject(stored) && Object.keys(stored).length === 0) return;
    const type = SAVED_VIEW_ARG_TYPES[field];
    // GitLab stores a lone author as a string and several as a list, for an argument
    // that takes one.
    const raw: unknown =
      type && !type.startsWith('[') && Array.isArray(stored) && stored.length === 1
        ? (stored as unknown[])[0]
        : stored;
    let value: unknown;
    if (type && graphqlSupports('Namespace', 'workItems', field)) {
      if (!type.startsWith('[') && Array.isArray(raw)) {
        value = undefined;
      } else if (Array.isArray(raw) && raw.length > 0 && raw.every(isPlainObject)) {
        value = raw.map((one, i) => inputValue(baseType(type), one, `${field}[${i}]`, unapplied));
      } else if (isPlainObject(raw)) {
        value = inputValue(baseType(type), raw, field, unapplied);
        if (Object.keys(value as object).length === 0) value = undefined;
      } else {
        value = enumValue(field, raw);
      }
    }
    if (value !== undefined) args[field] = value;
    else if (fromView && !unapplied.some((path) => path.startsWith(`${field}.`))) {
      unapplied.push(field);
    }
  };

  for (const [field, raw] of Object.entries({ ...defaults, ...stored })) {
    apply(field, raw, field in stored);
  }
  if (sort) apply('sort', sort, true);

  return { namespacePath: scoped ? fullPath : namespacePath, args, unapplied };
}

/**
 * Global ID of a saved view from its numeric ID or global ID. Any other global ID is
 * refused rather than read as a saved view.
 */
export function savedViewGid(id: string): string {
  if (/^\d+$/.test(id)) return `${SAVED_VIEW_GID_PREFIX}${id}`;
  if (
    id.startsWith(SAVED_VIEW_GID_PREFIX) &&
    /^\d+$/.test(id.slice(SAVED_VIEW_GID_PREFIX.length))
  ) {
    return id;
  }
  throw new Error(`"${id}" is not a saved view ID`);
}

function assertSavedViewsAvailable(): void {
  if (!graphqlSupports('Namespace', 'savedViews')) {
    throw new Error('This GitLab instance has no saved work item views');
  }
}

/** A view as the tools return it: numeric ID, visibility under one name. */
function presentView(view: SavedViewNode) {
  return {
    id: extractSimpleId(view.id),
    name: view.name,
    description: view.description,
    isPrivate: view.isPrivate ?? view.private ?? false,
    subscribed: view.subscribed,
    sort: view.sort,
    shareUrl: view.shareUrl,
    ...(view.updatedAt !== undefined && { updatedAt: view.updatedAt }),
    ...(view.author !== undefined && { author: view.author?.username ?? null }),
  };
}

/** The saved views of a namespace the current user can see. */
export async function listSavedViews(
  client: GraphQLClient,
  input: {
    namespace: string;
    search?: string;
    subscribed_only?: boolean;
    first: number;
    after?: string;
  },
) {
  assertSavedViewsAvailable();
  const { namespace } = await client.request(LIST_SAVED_VIEWS, {
    namespacePath: input.namespace,
    search: input.search,
    subscribedOnly: input.subscribed_only,
    first: input.first,
    after: input.after,
  });
  if (!namespace) {
    throw new Error(`Namespace "${input.namespace}" was not found or is not accessible`);
  }
  const views = namespace.savedViews;
  return {
    namespace: input.namespace,
    views: (views?.nodes ?? []).map(presentView),
    hasMore: views?.pageInfo.hasNextPage ?? false,
    endCursor: views?.pageInfo.endCursor ?? null,
  };
}

/**
 * IDs of the types GitLab's list offers by default in the namespace, when the instance
 * says which those are. Undefined when it does not; an empty list when every type is
 * offered, so no restriction is needed. `known` are the types already read for it.
 */
async function defaultTypeIds(
  client: GraphQLClient,
  namespacePath: string,
  known: FilterableTypes | null | undefined,
): Promise<string[] | undefined> {
  if (
    !graphqlSupports('WorkItemType', 'isFilterableListView') ||
    !graphqlSupports('Namespace', 'workItems', 'workItemTypeIds')
  ) {
    return undefined;
  }
  const types =
    known?.nodes ??
    (await client.request(GET_FILTERABLE_WORK_ITEM_TYPES, { namespacePath })).namespace
      ?.workItemTypes?.nodes ??
    [];
  return types.every((t) => t.isFilterableListView)
    ? []
    : types.filter((t) => t.isFilterableListView).map((t) => t.id);
}

/** A saved view with its items, as GitLab's work item list shows them. */
export interface SavedViewRead {
  view: ReturnType<typeof presentView> & {
    filters: Record<string, unknown>;
    displaySettings: Record<string, unknown> | null;
  };
  namespace: string;
  items: WorkItem[];
  hasMore: boolean;
  endCursor: string | null;
  /** False when a filter, the view's sort or the list's default types could not be applied. */
  exact: boolean;
  unappliedFilters?: string[];
  filterWarnings?: Array<{ field: string; message: string }>;
  note?: string;
}

/** Read one saved view and a page of the items it shows. */
export async function getSavedView(
  client: GraphQLClient,
  input: { namespace: string; view_id: string; first: number; after?: string },
): Promise<SavedViewRead> {
  assertSavedViewsAvailable();
  const id = savedViewGid(input.view_id);
  const { namespace } = await client.request(GET_SAVED_VIEW, {
    namespacePath: input.namespace,
    id,
  });
  if (!namespace) {
    throw new Error(`Namespace "${input.namespace}" was not found or is not accessible`);
  }
  const view: SavedViewDetail | undefined = namespace.savedViews?.nodes[0];
  if (!view) {
    throw new Error(
      `Saved view ${input.view_id} was not found in "${input.namespace}" or is not visible to you`,
    );
  }

  const filters = view.filters ?? {};
  const plan = planViewQuery(input.namespace, filters, view.sort);
  const notes: string[] = [];
  let typesApplied = true;
  if (filters.types === undefined && filters.workItemTypeIds === undefined) {
    const known =
      plan.namespacePath === input.namespace ? (namespace.workItemTypes ?? undefined) : undefined;
    const ids = await defaultTypeIds(client, plan.namespacePath, known);
    if (ids === undefined) {
      typesApplied = false;
      notes.push(
        'This GitLab instance does not say which work item types its list shows by default, so items of every type are included.',
      );
    } else if (ids.length > 0) {
      plan.args.workItemTypeIds = ids;
    }
  }
  if (!view.sort) {
    notes.push(
      "The view has no sort of its own; GitLab's default order is used, where its list would use your sort preference.",
    );
  }
  const unappliedFilters = plan.unapplied.filter((path) => path !== 'sort');
  if (unappliedFilters.length > 0) {
    notes.push(
      `This GitLab instance cannot apply ${unappliedFilters.join(', ')}, so the items may include some the view excludes.`,
    );
  }
  if (plan.unapplied.includes('sort')) {
    notes.push(`This GitLab instance cannot sort by ${view.sort}, so its default order is used.`);
  }
  const warnings = view.filterWarnings ?? [];
  if (warnings.length > 0) {
    notes.push(
      'GitLab dropped filter values that no longer exist (see filterWarnings), so the items may include some the view excluded.',
    );
  }

  const query = savedViewItemsQuery(Object.keys(plan.args));
  const data = await client.request(query, {
    namespacePath: plan.namespacePath,
    first: input.first,
    after: input.after,
    ...plan.args,
  });
  const items = data.namespace?.workItems;

  return {
    view: {
      ...presentView(view),
      filters,
      displaySettings: view.displaySettings,
    },
    namespace: plan.namespacePath,
    items: items?.nodes ?? [],
    hasMore: items?.pageInfo.hasNextPage ?? false,
    endCursor: items?.pageInfo.endCursor ?? null,
    exact: plan.unapplied.length === 0 && warnings.length === 0 && typesApplied,
    ...(plan.unapplied.length > 0 && { unappliedFilters: plan.unapplied }),
    ...(warnings.length > 0 && { filterWarnings: warnings }),
    ...(notes.length > 0 && { note: notes.join(' ') }),
  };
}
