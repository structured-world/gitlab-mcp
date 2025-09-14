import { GraphQLClient } from '../graphql/client';
import { GitLabVersionDetector, GitLabInstanceInfo } from './GitLabVersionDetector';
import { GITLAB_API_URL, GITLAB_TOKEN } from '../config';
import { logger } from '../logger';

export class ConnectionManager {
  private static instance: ConnectionManager | null = null;
  private client: GraphQLClient | null = null;
  private versionDetector: GitLabVersionDetector | null = null;
  private instanceInfo: GitLabInstanceInfo | null = null;
  private isInitialized: boolean = false;

  private constructor() {}

  public static getInstance(): ConnectionManager {
    if (!ConnectionManager.instance) {
      ConnectionManager.instance = new ConnectionManager();
    }
    return ConnectionManager.instance;
  }

  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      if (!GITLAB_API_URL || !GITLAB_TOKEN) {
        throw new Error('GitLab API URL and token are required');
      }

      // Construct GraphQL endpoint from base GITLAB_API_URL
      const endpoint = `${GITLAB_API_URL}/api/graphql`;

      this.client = new GraphQLClient(endpoint, {
        headers: {
          Authorization: `Bearer ${GITLAB_TOKEN}`,
        },
      });

      this.versionDetector = new GitLabVersionDetector(this.client);

      this.instanceInfo = await this.versionDetector.detectInstance();

      this.isInitialized = true;

      logger.info(
        {
          version: this.instanceInfo.version,
          tier: this.instanceInfo.tier,
          features: Object.entries(this.instanceInfo.features)
            .filter(([_, enabled]) => enabled)
            .map(([feature]) => feature),
        },
        'GitLab instance detected',
      );
    } catch (error) {
      logger.error({ err: error }, 'Failed to initialize connection');
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

  public getInstanceInfo(): GitLabInstanceInfo {
    if (!this.instanceInfo) {
      throw new Error('Connection not initialized. Call initialize() first.');
    }
    return this.instanceInfo;
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

  public reset(): void {
    this.client = null;
    this.versionDetector = null;
    this.instanceInfo = null;
    this.isInitialized = false;
  }
}
