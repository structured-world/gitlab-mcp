import type { GraphQLClient } from '../../graphql/client';
import {
  GET_FILTERABLE_WORK_ITEM_TYPES,
  SAVED_VIEW_ARG_TYPES,
  getSavedViewQuery,
  listSavedViewsQuery,
  savedViewItemsQuery,
  type FilterableTypes,
  type SavedViewDetail,
  type SavedViewExtras,
  type SavedViewNode,
} from '../../graphql/savedViews';
import { GET_NAMESPACE_TYPE, type WorkItem } from '../../graphql/workItems';
import { graphqlConfirms, graphqlSupports } from '../instance-version';
import { descendantsInCallScope, namespaceInCallScope } from '../../configuration/call-scope';
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
  // GitLab stores relative date units by name already; converting keeps any other form safe.
  unit: { enum: 'WorkItemRelativeDateUnit', name: upper },
};

const NEGATED_ENUM_FILTERS: Readonly<Record<string, EnumRule>> = {
  milestoneWildcardId: { enum: 'NegatedMilestoneWildcardId', name: upper },
  healthStatusFilter: { enum: 'HealthStatus', name: healthStatusName },
};

/** Named type under the list and non-null wrappers of a variable type. */
const baseType = (type: string): string => type.replace(/[[\]!]/g, '');

const isList = (type: string): boolean => type.startsWith('[');

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
 * A value inside an input object field, such as a relative date's amount and unit, with
 * its enum values converted; undefined when one of them cannot be sent.
 */
function nestedValue(value: unknown, field: string, parent: string): unknown {
  if (!isPlainObject(value)) return enumValue(field, value, parent);
  const kept: Record<string, unknown> = {};
  for (const [inner, raw] of Object.entries(value)) {
    const converted = nestedValue(raw, inner, field);
    if (converted === undefined) return undefined;
    kept[inner] = converted;
  }
  return kept;
}

/**
 * The fields of an input object filter the instance accepts, with enum values
 * converted. Fields it lacks or cannot take are reported by their path and left out.
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
    const converted = graphqlSupports(type, field) ? nestedValue(raw, field, path) : undefined;
    if (converted === undefined) unapplied.push(`${path}.${field}`);
    else kept[field] = converted;
  }
  return kept;
}

/**
 * The value of one `workItems` argument, or undefined when it cannot be sent. GitLab
 * stores a lone author as a string and several as a list, for an argument taking one.
 */
function argValue(field: string, type: string, stored: unknown, unapplied: string[]): unknown {
  const raw: unknown =
    !isList(type) && Array.isArray(stored) && stored.length === 1
      ? (stored as unknown[])[0]
      : stored;
  if (Array.isArray(raw)) {
    if (!isList(type)) return undefined;
    if (raw.length > 0 && raw.every(isPlainObject)) {
      return raw.map((one, i) => inputValue(baseType(type), one, `${field}[${i}]`, unapplied));
    }
    return enumValue(field, raw);
  }
  if (!isPlainObject(raw)) return enumValue(field, raw);
  const kept = inputValue(baseType(type), raw, field, unapplied);
  return Object.keys(kept).length > 0 ? kept : undefined;
}

/** How a saved view's items are read: where, with which arguments, and what was left out. */
export interface ViewQueryPlan {
  namespacePath: string;
  args: Record<string, unknown>;
  /** Filters (by path, such as `not.types`) this instance cannot apply; omitting them broadens the result. */
  unapplied: string[];
}

/** Adds one stored filter to the plan; an unsendable one of the view is reported. */
function planField(plan: ViewQueryPlan, field: string, stored: unknown, fromView: boolean): void {
  // An empty input object (`not: {}`) filters nothing.
  if (stored === null || stored === undefined) return;
  if (isPlainObject(stored) && Object.keys(stored).length === 0) return;
  const type = SAVED_VIEW_ARG_TYPES[field];
  const value =
    type && graphqlSupports('Namespace', 'workItems', field)
      ? argValue(field, type, stored, plan.unapplied)
      : undefined;
  if (value !== undefined) plan.args[field] = value;
  else if (fromView && !plan.unapplied.some((path) => path.startsWith(`${field}.`))) {
    plan.unapplied.push(field);
  }
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
  const plan: ViewQueryPlan = {
    namespacePath: scoped ? fullPath : namespacePath,
    args: {},
    unapplied: [],
  };
  for (const [field, raw] of Object.entries({ ...defaults, ...stored })) {
    planField(plan, field, raw, field in stored);
  }
  if (sort) planField(plan, 'sort', sort, true);
  return plan;
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

/** The view fields newer than GitLab 18.9 that this instance's schema confirms. */
function savedViewExtras(): SavedViewExtras {
  return {
    isPrivate: graphqlConfirms('WorkItemSavedViewType', 'isPrivate'),
    updatedAt: graphqlConfirms('WorkItemSavedViewType', 'updatedAt'),
    author: graphqlConfirms('WorkItemSavedViewType', 'author'),
    filterableTypes: graphqlConfirms('WorkItemType', 'isFilterableListView'),
  };
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
  const { namespace } = await client.request(listSavedViewsQuery(savedViewExtras()), {
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
 * offered, so no restriction is needed. `known` holds the types already read for it.
 */
async function defaultTypeIds(
  client: GraphQLClient,
  namespacePath: string,
  known: { types: FilterableTypes | null | undefined } | undefined,
): Promise<string[] | undefined> {
  if (
    !graphqlConfirms('WorkItemType', 'isFilterableListView') ||
    !graphqlSupports('Namespace', 'workItems', 'workItemTypeIds')
  ) {
    return undefined;
  }
  const read =
    known ??
    ({
      types: (await client.request(GET_FILTERABLE_WORK_ITEM_TYPES, { namespacePath })).namespace
        ?.workItemTypes,
    } as const);
  const types = read.types?.nodes;
  // No list from GitLab says nothing about its defaults.
  if (!types) return undefined;
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
  /**
   * False when a filter, the view's sort, the list's default types or the view's whole
   * reach could not be applied.
   */
  exact: boolean;
  unappliedFilters?: string[];
  filterWarnings?: Array<{ field: string; message: string }>;
  note?: string;
}

type GetSavedViewInput = { namespace: string; view_id: string; first: number; after?: string };

/** The view and, when GitLab says which its list offers, its namespace's types. */
async function readView(client: GraphQLClient, input: GetSavedViewInput, extras: SavedViewExtras) {
  const { namespace } = await client.request(getSavedViewQuery(extras), {
    namespacePath: input.namespace,
    id: savedViewGid(input.view_id),
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
  return { view, namespace };
}

/** A filtered namespace the reader cannot see, which an empty page would hide. */
const inaccessible = (input: GetSavedViewInput, path: string) =>
  new Error(
    `Saved view ${input.view_id} lists work items of "${path}", which was not found or is not accessible`,
  );

/**
 * Holds the plan to what the call may read: a namespace the view's group filter reaches
 * beyond the one the call named is refused when the call may not read it, checked as
 * the group or project it is, and the descendants of a group are left out when they are
 * not all in scope. `namedIsGroup` is the kind of the namespace the call named. True
 * when the plan was narrowed.
 */
async function keepToCallScope(
  client: GraphQLClient,
  plan: ViewQueryPlan,
  input: GetSavedViewInput,
  namedIsGroup: boolean,
): Promise<boolean> {
  let isGroup = namedIsGroup;
  if (plan.namespacePath !== input.namespace) {
    const { namespace } = await client.request(GET_NAMESPACE_TYPE, {
      namespacePath: plan.namespacePath,
    });
    if (!namespace) throw inaccessible(input, plan.namespacePath);
    isGroup = namespace.__typename === 'Group';
    if (!(await namespaceInCallScope(plan.namespacePath, isGroup ? 'group' : 'project'))) {
      throw new Error(
        `Saved view ${input.view_id} lists work items of "${plan.namespacePath}", outside the projects and groups this call may read`,
      );
    }
  }
  if (!isGroup || plan.args.includeDescendants !== true) return false;
  if (descendantsInCallScope(plan.namespacePath)) return false;
  plan.args.includeDescendants = false;
  return true;
}

/** Why the result may differ from what the view shows, one sentence per reason. */
function resultNotes(
  view: SavedViewDetail,
  plan: ViewQueryPlan,
  typesApplied: boolean,
  narrowed: boolean,
): string[] {
  const notes: string[] = [];
  if (!typesApplied) {
    notes.push(
      'This GitLab instance does not say which work item types its list shows by default, so items of every type are included.',
    );
  }
  if (narrowed) {
    notes.push(
      `Subgroups and projects of "${plan.namespacePath}" are outside the working scope, so only the group's own work items are listed.`,
    );
  }
  if (!view.sort) {
    notes.push(
      "The view has no sort of its own; GitLab's default order is used, where its list would use your sort preference.",
    );
  }
  const filters = plan.unapplied.filter((path) => path !== 'sort');
  if (filters.length > 0) {
    notes.push(
      `This GitLab instance cannot apply ${filters.join(', ')}, so the items may include some the view excludes.`,
    );
  }
  if (plan.unapplied.includes('sort')) {
    notes.push(`This GitLab instance cannot sort by ${view.sort}, so its default order is used.`);
  }
  if ((view.filterWarnings ?? []).length > 0) {
    notes.push(
      'GitLab dropped filter values that no longer exist (see filterWarnings), so the items may include some the view excluded.',
    );
  }
  return notes;
}

/**
 * A page of the planned listing. A namespace the reader cannot see is an error: a shared
 * view may filter on a project only its author can read, and an empty page would read as
 * "no matches".
 */
async function readItems(client: GraphQLClient, plan: ViewQueryPlan, input: GetSavedViewInput) {
  const data = await client.request(savedViewItemsQuery(Object.keys(plan.args)), {
    namespacePath: plan.namespacePath,
    first: input.first,
    after: input.after,
    ...plan.args,
  });
  const items = data.namespace?.workItems;
  if (!items) throw inaccessible(input, plan.namespacePath);
  return items;
}

/** Read one saved view and a page of the items it shows. */
export async function getSavedView(
  client: GraphQLClient,
  input: GetSavedViewInput,
): Promise<SavedViewRead> {
  assertSavedViewsAvailable();
  const extras = savedViewExtras();
  const { view, namespace } = await readView(client, input, extras);
  const filters = view.filters ?? {};
  const plan = planViewQuery(input.namespace, filters, view.sort);
  const sameNamespace = plan.namespacePath === input.namespace;
  const narrowed = await keepToCallScope(client, plan, input, namespace.__typename === 'Group');

  let typesApplied = true;
  if (filters.types === undefined && filters.workItemTypeIds === undefined) {
    const known =
      sameNamespace && extras.filterableTypes ? { types: namespace.workItemTypes } : undefined;
    const ids = await defaultTypeIds(client, plan.namespacePath, known);
    if (ids === undefined) typesApplied = false;
    else if (ids.length > 0) plan.args.workItemTypeIds = ids;
  }

  const items = await readItems(client, plan, input);
  const warnings = view.filterWarnings ?? [];
  const notes = resultNotes(view, plan, typesApplied, narrowed);
  return {
    view: { ...presentView(view), filters, displaySettings: view.displaySettings },
    namespace: plan.namespacePath,
    items: items.nodes,
    hasMore: items.pageInfo.hasNextPage,
    endCursor: items.pageInfo.endCursor ?? null,
    exact: notes.length === 0,
    ...(plan.unapplied.length > 0 && { unappliedFilters: plan.unapplied }),
    ...(warnings.length > 0 && { filterWarnings: warnings }),
    ...(notes.length > 0 && { note: notes.join(' ') }),
  };
}
