import { GraphQLClient } from '../graphql/client';
import { GitLabVersionDetector, GitLabInstanceInfo } from './GitLabVersionDetector';
import { SchemaIntrospector, SchemaInfo } from './SchemaIntrospector';
import { GITLAB_BASE_URL, GITLAB_TOKEN } from '../config';
import { logger } from '../logger';

export class ConnectionManager {
  private static instance: ConnectionManager | null = null;
  private client: GraphQLClient | null = null;
  private versionDetector: GitLabVersionDetector | null = null;
  private schemaIntrospector: SchemaIntrospector | null = null;
  private instanceInfo: GitLabInstanceInfo | null = null;
  private schemaInfo: SchemaInfo | null = null;
  private isInitialized: boolean = false;

  private constructor() {}

  public static getInstance(): ConnectionManager {
    ConnectionManager.instance ??= new ConnectionManager();
    return ConnectionManager.instance;
  }

  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      if (!GITLAB_BASE_URL || !GITLAB_TOKEN) {
        throw new Error('GitLab base URL and token are required');
      }

      // Construct GraphQL endpoint from base URL
      const endpoint = `${GITLAB_BASE_URL}/api/graphql`;

      this.client = new GraphQLClient(endpoint, {
        headers: {
          Authorization: `Bearer ${GITLAB_TOKEN}`,
        },
      });

      this.versionDetector = new GitLabVersionDetector(this.client);
      this.schemaIntrospector = new SchemaIntrospector(this.client);

      // Detect instance info and introspect schema in parallel
      const [instanceInfo, schemaInfo] = await Promise.all([
        this.versionDetector.detectInstance(),
        this.schemaIntrospector.introspectSchema(),
      ]);

      this.instanceInfo = instanceInfo;
      this.schemaInfo = schemaInfo;
      this.isInitialized = true;

      logger.info(
        {
          version: this.instanceInfo.version,
          tier: this.instanceInfo.tier,
          features: Object.entries(this.instanceInfo.features)
            .filter(([, enabled]) => enabled)
            .map(([feature]) => feature),
          widgetTypes: this.schemaInfo.workItemWidgetTypes.length,
          schemaTypes: this.schemaInfo.typeDefinitions.size,
        },
        'GitLab instance and schema detected',
      );
    } catch (error) {
      logger.error({ err: error as Error }, 'Failed to initialize connection');
      throw error;
    }
  }

  public getClient(): GraphQLClient {
    if (!this.client) {
      throw new Error('Connection not initialized. Call initialize() first.');
    }
    return this.client;
  }

  public getVersionDetector(): GitLabVersionDetector {
    if (!this.versionDetector) {
      throw new Error('Connection not initialized. Call initialize() first.');
    }
    return this.versionDetector;
  }

  public getSchemaIntrospector(): SchemaIntrospector {
    if (!this.schemaIntrospector) {
      throw new Error('Connection not initialized. Call initialize() first.');
    }
    return this.schemaIntrospector;
  }

  public getInstanceInfo(): GitLabInstanceInfo {
    if (!this.instanceInfo) {
      throw new Error('Connection not initialized. Call initialize() first.');
    }
    return this.instanceInfo;
  }

  public getSchemaInfo(): SchemaInfo {
    if (!this.schemaInfo) {
      throw new Error('Connection not initialized. Call initialize() first.');
    }
    return this.schemaInfo;
  }

  public isFeatureAvailable(feature: keyof GitLabInstanceInfo['features']): boolean {
    if (!this.instanceInfo) {
      return false;
    }
    return this.instanceInfo.features[feature];
  }

  public getTier(): string {
    if (!this.instanceInfo) {
      return 'unknown';
    }
    return this.instanceInfo.tier;
  }

  public getVersion(): string {
    if (!this.instanceInfo) {
      return 'unknown';
    }
    return this.instanceInfo.version;
  }

  public isWidgetAvailable(widgetType: string): boolean {
    if (!this.schemaIntrospector) {
      return false;
    }
    return this.schemaIntrospector.isWidgetTypeAvailable(widgetType);
  }

  public reset(): void {
    this.client = null;
    this.versionDetector = null;
    this.schemaIntrospector = null;
    this.instanceInfo = null;
    this.schemaInfo = null;
    this.isInitialized = false;
  }
}
