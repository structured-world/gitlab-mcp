import { GraphQLClient } from '../graphql/client';
import { gql } from 'graphql-tag';
import { logDebug, logInfo, logWarn } from '../logger';

export interface FieldInfo {
  name: string;
  type: {
    name: string | null;
    kind: string;
    ofType?: {
      name: string | null;
      kind: string;
    } | null;
  };
}

export interface TypeInfo {
  name: string;
  fields: FieldInfo[] | null;
  enumValues?: Array<{ name: string; description?: string }> | null;
}

/** A field of an output type: the named type it resolves to and its argument names. */
export interface IndexedField {
  type: string;
  args: ReadonlySet<string>;
}

/**
 * Every type the instance's GraphQL schema declares, with its fields (output
 * types) or input fields (input objects). Types without either (unions, enums,
 * scalars) map to an empty field map so their existence can still be checked.
 */
export type SchemaFieldIndex = ReadonlyMap<string, ReadonlyMap<string, IndexedField>>;

export interface SchemaInfo {
  workItemWidgetTypes: string[];
  typeDefinitions: Map<string, TypeInfo>;
  availableFeatures: Set<string>;
  /** Absent when introspection failed; callers then cannot adapt to the schema. */
  fieldIndex?: SchemaFieldIndex;
}

interface IntrospectionTypeRef {
  name: string | null;
  kind: string;
  ofType?: IntrospectionTypeRef | null;
}

interface IntrospectionType {
  name: string;
  kind: string;
  fields?: Array<FieldInfo & { args?: Array<{ name: string }> }> | null;
  inputFields?: Array<{ name: string }> | null;
  enumValues?: Array<{ name: string; description?: string }> | null;
}

/** Named type at the bottom of a NON_NULL/LIST wrapper chain. */
function namedType(ref: IntrospectionTypeRef | null | undefined): string {
  let current = ref;
  while (current && !current.name) current = current.ofType;
  return current?.name ?? '';
}

function buildFieldIndex(types: IntrospectionType[]): SchemaFieldIndex {
  const index = new Map<string, Map<string, IndexedField>>();
  for (const type of types) {
    if (!type.name) continue;
    const fields = new Map<string, IndexedField>();
    for (const field of type.fields ?? []) {
      fields.set(field.name, {
        type: namedType(field.type),
        args: new Set((field.args ?? []).map((arg) => arg.name)),
      });
    }
    // Input object fields, so handlers can tell which mutation inputs exist.
    for (const inputField of type.inputFields ?? []) {
      fields.set(inputField.name, { type: '', args: new Set() });
    }
    index.set(type.name, fields);
  }
  return index;
}

interface IntrospectionResult {
  __schema: {
    types: IntrospectionType[];
  };
}

const INTROSPECTION_QUERY = gql`
  query IntrospectSchema {
    __schema {
      types {
        name
        kind
        fields {
          name
          args {
            name
          }
          type {
            name
            kind
            ofType {
              name
              kind
              ofType {
                name
                kind
                ofType {
                  name
                  kind
                }
              }
            }
          }
        }
        inputFields {
          name
        }
        enumValues {
          name
          description
        }
      }
    }
  }
`;

export class SchemaIntrospector {
  private client: GraphQLClient;
  private cachedSchema: SchemaInfo | null = null;

  constructor(client: GraphQLClient) {
    this.client = client;
  }

  public async introspectSchema(): Promise<SchemaInfo> {
    if (this.cachedSchema) {
      return this.cachedSchema;
    }

    try {
      logDebug('Introspecting GitLab GraphQL schema...');

      const result = await this.client.request<IntrospectionResult>(INTROSPECTION_QUERY);
      const types = result.__schema.types;

      // Extract WorkItem widget types
      const workItemWidgetType = types.find((type) => type.name === 'WorkItemWidgetType');
      const workItemWidgetTypes = workItemWidgetType?.enumValues?.map((value) => value.name) ?? [];

      // Build type definitions map
      const typeDefinitions = new Map<string, TypeInfo>();

      // Focus on WorkItem-related types
      const relevantTypes = types.filter(
        (type) =>
          type.name &&
          (type.name.startsWith('WorkItem') ||
            type.name.includes('Widget') ||
            type.name === 'AwardEmoji' ||
            type.name === 'Milestone' ||
            type.name === 'User' ||
            type.name === 'Label'),
      );

      for (const type of relevantTypes) {
        typeDefinitions.set(type.name, {
          name: type.name,
          fields: type.fields ?? null,
          enumValues: type.enumValues ?? null,
        });
      }

      // Determine available features based on widget types
      const availableFeatures = new Set<string>();
      for (const widgetType of workItemWidgetTypes) {
        availableFeatures.add(widgetType);
      }

      this.cachedSchema = {
        workItemWidgetTypes,
        typeDefinitions,
        availableFeatures,
        fieldIndex: buildFieldIndex(types),
      };

      logInfo('GraphQL schema introspection completed', {
        widgetTypes: workItemWidgetTypes.length,
        typeDefinitions: typeDefinitions.size,
        features: availableFeatures.size,
      });

      return this.cachedSchema;
    } catch (error) {
      logWarn('Schema introspection failed, using fallback schema info', {
        err: error as Error,
      });

      // Provide fallback schema info when introspection fails
      this.cachedSchema = {
        workItemWidgetTypes: [
          'ASSIGNEES',
          'LABELS',
          'MILESTONE',
          'DESCRIPTION',
          'START_AND_DUE_DATE',
          'WEIGHT',
          'TIME_TRACKING',
          'HEALTH_STATUS',
          'COLOR',
          'NOTIFICATIONS',
          'NOTES',
        ],
        typeDefinitions: new Map(),
        availableFeatures: new Set(['workItems', 'epics', 'issues']),
      };

      return this.cachedSchema;
    }
  }

  public isWidgetTypeAvailable(widgetType: string): boolean {
    if (!this.cachedSchema) {
      throw new Error('Schema not introspected yet. Call introspectSchema() first.');
    }
    return this.cachedSchema.availableFeatures.has(widgetType);
  }

  public getFieldsForType(typeName: string): FieldInfo[] {
    if (!this.cachedSchema) {
      throw new Error('Schema not introspected yet. Call introspectSchema() first.');
    }

    const typeInfo = this.cachedSchema.typeDefinitions.get(typeName);
    if (typeInfo?.fields) {
      return typeInfo.fields;
    }

    // Fallback field information for common widget types when full schema unavailable
    if (typeName === 'WorkItemWidgetAssignees') {
      return [{ name: 'assignees', type: { name: 'UserConnection', kind: 'OBJECT' } }];
    }
    if (typeName === 'WorkItemWidgetLabels') {
      return [{ name: 'labels', type: { name: 'LabelConnection', kind: 'OBJECT' } }];
    }
    if (typeName === 'WorkItemWidgetMilestone') {
      return [{ name: 'milestone', type: { name: 'Milestone', kind: 'OBJECT' } }];
    }

    return [];
  }

  public hasField(typeName: string, fieldName: string): boolean {
    const fields = this.getFieldsForType(typeName);
    return fields.some((field) => field.name === fieldName);
  }

  public getAvailableWidgetTypes(): string[] {
    if (!this.cachedSchema) {
      throw new Error('Schema not introspected yet. Call introspectSchema() first.');
    }
    return this.cachedSchema.workItemWidgetTypes;
  }

  public generateSafeWidgetQuery(requestedWidgets: string[]): string {
    if (!this.cachedSchema) {
      throw new Error('Schema not introspected yet. Call introspectSchema() first.');
    }

    const safeWidgets: string[] = [];

    for (const widget of requestedWidgets) {
      if (this.isWidgetTypeAvailable(widget)) {
        const widgetTypeName = `WorkItemWidget${
          widget.charAt(0) +
          widget
            .slice(1)
            .toLowerCase()
            .replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
        }`;

        // Generate safe field selections for this widget
        const fields = this.getFieldsForType(widgetTypeName);
        const safeFields = this.generateSafeFieldSelections(fields);

        if (safeFields.length > 0) {
          safeWidgets.push(`
            ... on ${widgetTypeName} {
              ${safeFields.join('\n              ')}
            }
          `);
        }
      }
    }

    return safeWidgets.join('\n');
  }

  private generateSafeFieldSelections(fields: FieldInfo[]): string[] {
    const safeFields: string[] = [];

    for (const field of fields) {
      // Skip complex fields that require sub-selections for now
      if (field.type.kind === 'SCALAR' || field.type.kind === 'ENUM') {
        safeFields.push(field.name);
      } else if (field.type.kind === 'OBJECT' && field.name !== 'type') {
        // Add basic object fields with simple sub-selections
        if (field.name === 'milestone') {
          safeFields.push(`${field.name} { id title state }`);
        } else if (field.name === 'assignees' || field.name === 'participants') {
          safeFields.push(`${field.name} { nodes { id username } }`);
        } else if (field.name === 'labels') {
          safeFields.push(`${field.name} { nodes { id title color } }`);
        }
      }
    }

    return safeFields;
  }

  /**
   * Populate the internal cache from externally-provided SchemaInfo.
   * Used when ConnectionManager restores introspection data from its caches
   * (introspectionCache or InstanceRegistry) so that callers who access
   * the SchemaIntrospector directly (e.g. DynamicWorkItemsQuery) see the
   * same widget/type data without a redundant GraphQL introspection call.
   */
  public rehydrate(schema: SchemaInfo): void {
    this.cachedSchema = schema;
  }

  public getCachedSchema(): SchemaInfo | null {
    return this.cachedSchema;
  }

  public clearCache(): void {
    this.cachedSchema = null;
  }
}
