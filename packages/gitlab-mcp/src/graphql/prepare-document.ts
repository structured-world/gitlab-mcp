import {
  DirectiveNode,
  DocumentNode,
  Kind,
  OperationDefinitionNode,
  SelectionNode,
  SelectionSetNode,
  visit,
} from 'graphql';
import type { SchemaFieldIndex } from '../services/SchemaIntrospector';

/**
 * Client-side directive marking a field as non-essential: when the connected
 * instance's schema lacks it, the field is dropped instead of failing the whole
 * query. Never sent to GitLab.
 */
export const OPTIONAL_DIRECTIVE = 'optional';

export interface PreparedDocument {
  document: DocumentNode;
  /** Variables the prepared document still declares; others must not be sent. */
  variableNames: ReadonlySet<string>;
}

const isOptional = (directives?: readonly DirectiveNode[]): boolean =>
  directives?.some((d) => d.name.value === OPTIONAL_DIRECTIVE) ?? false;

const stripOptional = (directives?: readonly DirectiveNode[]): DirectiveNode[] | undefined =>
  directives?.filter((d) => d.name.value !== OPTIONAL_DIRECTIVE);

/**
 * Selection for a kept field (or operation) whose every sub-selection was
 * dropped: a composite type needs at least one field, and __typename exists on
 * every type.
 */
const typenameOnly = (set: SelectionSetNode): SelectionSetNode => ({
  ...set,
  selections: [{ kind: Kind.FIELD, name: { kind: Kind.NAME, value: '__typename' } }],
});

/**
 * Drop what the instance cannot answer. An inline fragment on a type the schema
 * does not declare can never match, so it always goes. A missing field goes only
 * when marked @optional; an essential missing field is left in place so GitLab
 * reports it and the caller can fall back or fail loudly. Returns undefined when
 * nothing selectable remains.
 */
function pruneSelectionSet(
  set: SelectionSetNode,
  typeName: string | undefined,
  index: SchemaFieldIndex | undefined,
): SelectionSetNode | undefined {
  const fields = typeName ? index?.get(typeName) : undefined;
  const selections: SelectionNode[] = [];

  for (const selection of set.selections) {
    if (selection.kind === Kind.FIELD) {
      const optional = isOptional(selection.directives);
      const field = fields?.get(selection.name.value);
      if (optional && fields && !field && selection.name.value !== '__typename') continue;

      let selectionSet = selection.selectionSet;
      if (selectionSet) {
        const pruned = pruneSelectionSet(selectionSet, field?.type, index);
        if (!pruned && optional) continue;
        selectionSet = pruned ?? typenameOnly(selectionSet);
      }
      selections.push({
        ...selection,
        directives: stripOptional(selection.directives),
        selectionSet,
      });
      continue;
    }

    if (selection.kind === Kind.INLINE_FRAGMENT) {
      const condition = selection.typeCondition?.name.value;
      if (condition && index && !index.has(condition)) continue;
      const pruned = pruneSelectionSet(selection.selectionSet, condition ?? typeName, index);
      if (!pruned) continue;
      selections.push({
        ...selection,
        directives: stripOptional(selection.directives),
        selectionSet: pruned,
      });
      continue;
    }

    selections.push(selection);
  }

  return selections.length > 0 ? { ...set, selections } : undefined;
}

function prepare(document: DocumentNode, index: SchemaFieldIndex | undefined): PreparedDocument {
  const pruned: DocumentNode = {
    ...document,
    definitions: document.definitions.map((definition) => {
      if (definition.kind !== Kind.OPERATION_DEFINITION) return definition;
      const root = definition.operation === 'mutation' ? 'Mutation' : 'Query';
      const selectionSet =
        pruneSelectionSet(definition.selectionSet, root, index) ??
        typenameOnly(definition.selectionSet);
      return { ...definition, selectionSet };
    }),
  };

  // Variables referenced only by pruned selections must not stay declared:
  // GitLab rejects a declared-but-unused variable.
  const used = new Set<string>();
  visit(pruned, {
    VariableDefinition: () => false,
    Variable: (node) => {
      used.add(node.name.value);
    },
  });

  const result: DocumentNode = {
    ...pruned,
    definitions: pruned.definitions.map((definition) =>
      definition.kind === Kind.OPERATION_DEFINITION
        ? ({
            ...definition,
            variableDefinitions: definition.variableDefinitions?.filter((v) =>
              used.has(v.variable.name.value),
            ),
          } satisfies OperationDefinitionNode)
        : definition,
    ),
  };

  return { document: result, variableNames: used };
}

// Prepared documents are pure functions of (document, schema); both are
// long-lived, so memoise per pair without pinning either in memory.
const NO_SCHEMA = {};
const cache = new WeakMap<DocumentNode, WeakMap<object, PreparedDocument>>();

/**
 * Adapt a document to the instance schema (see pruneSelectionSet) and strip the
 * client-only @optional directive. Without a schema index nothing is pruned.
 */
export function prepareDocument(
  document: DocumentNode,
  index: SchemaFieldIndex | undefined,
): PreparedDocument {
  const key = index ?? NO_SCHEMA;
  let perSchema = cache.get(document);
  if (!perSchema) cache.set(document, (perSchema = new WeakMap()));
  let prepared = perSchema.get(key);
  if (!prepared) perSchema.set(key, (prepared = prepare(document, index)));
  return prepared;
}
