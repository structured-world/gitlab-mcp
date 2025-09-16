import { gql } from 'graphql-tag';
import { TypedDocumentNode } from '@graphql-typed-document-node/core';

// Work Item Types
export interface WorkItem {
  id: string;
  iid: string;
  title: string;
  description?: string;
  state: WorkItemState;
  workItemType: {
    id: string;
    name: string;
  };
  widgets: WorkItemWidget[];
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
  webUrl: string;
}

// Work Item State enum - defines possible states
export type WorkItemState = 'OPEN' | 'CLOSED';

// Work Item Type enum - defines all available work item types
export type WorkItemTypeEnum =
  | 'EPIC'
  | 'ISSUE'
  | 'TASK'
  | 'INCIDENT'
  | 'TEST_CASE'
  | 'REQUIREMENT'
  | 'OBJECTIVE'
  | 'KEY_RESULT';

// Work Item Widget Type constants
export const WorkItemWidgetTypes = {
  ASSIGNEES: 'ASSIGNEES',
  DESCRIPTION: 'DESCRIPTION',
  HIERARCHY: 'HIERARCHY',
  LABELS: 'LABELS',
  MILESTONE: 'MILESTONE',
  NOTES: 'NOTES',
  START_AND_DUE_DATE: 'START_AND_DUE_DATE',
  HEALTH_STATUS: 'HEALTH_STATUS',
  WEIGHT: 'WEIGHT',
  ITERATION: 'ITERATION',
  PROGRESS: 'PROGRESS',
  STATUS: 'STATUS',
  REQUIREMENT_LEGACY: 'REQUIREMENT_LEGACY',
  TEST_REPORTS: 'TEST_REPORTS',
  NOTIFICATIONS: 'NOTIFICATIONS',
  CURRENT_USER_TODOS: 'CURRENT_USER_TODOS',
  AWARD_EMOJI: 'AWARD_EMOJI',
  LINKED_ITEMS: 'LINKED_ITEMS',
  COLOR: 'COLOR',
  // New widgets discovered on GitLab instance
  PARTICIPANTS: 'PARTICIPANTS',
  DESIGNS: 'DESIGNS',
  DEVELOPMENT: 'DEVELOPMENT',
  CRM_CONTACTS: 'CRM_CONTACTS',
  TIME_TRACKING: 'TIME_TRACKING',
  EMAIL_PARTICIPANTS: 'EMAIL_PARTICIPANTS',
  CUSTOM_FIELDS: 'CUSTOM_FIELDS',
  ERROR_TRACKING: 'ERROR_TRACKING',
  LINKED_RESOURCES: 'LINKED_RESOURCES',
  VULNERABILITIES: 'VULNERABILITIES',
} as const;

// Work Item Widget Type type - defines all available widget types
export type WorkItemWidgetType = (typeof WorkItemWidgetTypes)[keyof typeof WorkItemWidgetTypes];

export interface WorkItemWidget {
  type: WorkItemWidgetType;
}

export interface WorkItemAssigneesWidget extends WorkItemWidget {
  type: 'ASSIGNEES';
  allowsMultipleAssignees: boolean;
  canInviteMembers: boolean;
  assignees: {
    nodes: User[];
  };
}

export interface WorkItemDescriptionWidget extends WorkItemWidget {
  type: 'DESCRIPTION';
  description: string;
  descriptionHtml: string;
  edited: boolean;
  lastEditedAt?: string;
  lastEditedBy?: User;
}

export interface WorkItemHierarchyWidget extends WorkItemWidget {
  type: 'HIERARCHY';
  parent?: WorkItem;
  children: {
    nodes: WorkItem[];
  };
  hasChildren: boolean;
}

export interface WorkItemLabelsWidget extends WorkItemWidget {
  type: 'LABELS';
  allowsScopedLabels: boolean;
  labels: {
    nodes: Label[];
  };
}

export interface User {
  id: string;
  username: string;
  name: string;
  avatarUrl?: string;
  webUrl: string;
}

export interface Label {
  id: string;
  title: string;
  description?: string;
  color: string;
  textColor: string;
}

export interface Milestone {
  id: string;
  title: string;
  description?: string;
  state: MilestoneStateEnum;
  dueDate?: string;
  startDate?: string;
  webUrl: string;
}

export type MilestoneStateEnum = 'active' | 'closed';

// New widget interfaces for GitLab Ultimate features
export interface WorkItemMilestoneWidget extends WorkItemWidget {
  type: 'MILESTONE';
  milestone?: Milestone;
}

export interface WorkItemNotesWidget extends WorkItemWidget {
  type: 'NOTES';
  discussions: {
    nodes: Discussion[];
  };
}

export interface WorkItemStartAndDueDateWidget extends WorkItemWidget {
  type: 'START_AND_DUE_DATE';
  startDate?: string;
  dueDate?: string;
  isFixed: boolean;
}

export interface WorkItemHealthStatusWidget extends WorkItemWidget {
  type: 'HEALTH_STATUS';
  healthStatus?: HealthStatusEnum;
}

export interface WorkItemWeightWidget extends WorkItemWidget {
  type: 'WEIGHT';
  weight?: number;
}

export interface WorkItemStatusWidget extends WorkItemWidget {
  type: 'STATUS';
  status?: string;
}

export interface WorkItemTimeTrackingWidget extends WorkItemWidget {
  type: 'TIME_TRACKING';
  timeEstimate?: number;
  totalTimeSpent?: number;
  humanTimeEstimate?: string;
  humanTotalTimeSpent?: string;
}

export interface WorkItemParticipantsWidget extends WorkItemWidget {
  type: 'PARTICIPANTS';
  participants: {
    nodes: User[];
  };
}

export interface WorkItemProgressWidget extends WorkItemWidget {
  type: 'PROGRESS';
  currentValue?: number;
  endValue?: number;
  progress?: number;
  startValue?: number;
}

export interface WorkItemRequirementLegacyWidget extends WorkItemWidget {
  type: 'REQUIREMENT_LEGACY';
}

export interface WorkItemTestReportsWidget extends WorkItemWidget {
  type: 'TEST_REPORTS';
  testReports?: TestReport[];
}

export interface WorkItemNotificationsWidget extends WorkItemWidget {
  type: 'NOTIFICATIONS';
  subscribed: boolean;
  emailsDisabled: boolean;
}

export interface WorkItemCurrentUserTodosWidget extends WorkItemWidget {
  type: 'CURRENT_USER_TODOS';
  currentUserTodos: {
    nodes: Todo[];
  };
}

export interface WorkItemAwardEmojiWidget extends WorkItemWidget {
  type: 'AWARD_EMOJI';
  awardEmoji: {
    nodes: AwardEmoji[];
  };
  upvotes: number;
  downvotes: number;
}

export interface WorkItemLinkedItemsWidget extends WorkItemWidget {
  type: 'LINKED_ITEMS';
  linkedItems: {
    nodes: WorkItem[];
  };
}

export interface WorkItemColorWidget extends WorkItemWidget {
  type: 'COLOR';
  color?: string;
}

export interface WorkItemDesignsWidget extends WorkItemWidget {
  type: 'DESIGNS';
  designs: {
    nodes: Design[];
  };
}

export interface WorkItemDevelopmentWidget extends WorkItemWidget {
  type: 'DEVELOPMENT';
  closingMergeRequests: {
    nodes: MergeRequest[];
  };
  featureFlags: {
    nodes: FeatureFlag[];
  };
}

export interface WorkItemCrmContactsWidget extends WorkItemWidget {
  type: 'CRM_CONTACTS';
  contacts: {
    nodes: Contact[];
  };
}

export interface WorkItemEmailParticipantsWidget extends WorkItemWidget {
  type: 'EMAIL_PARTICIPANTS';
  emailParticipants: {
    nodes: Array<{ email: string }>;
  };
}

export interface WorkItemCustomFieldsWidget extends WorkItemWidget {
  type: 'CUSTOM_FIELDS';
  customFields: {
    nodes: CustomField[];
  };
}

export interface WorkItemErrorTrackingWidget extends WorkItemWidget {
  type: 'ERROR_TRACKING';
  errorTrackingEnabled: boolean;
  errors: {
    nodes: Error[];
  };
}

export interface WorkItemLinkedResourcesWidget extends WorkItemWidget {
  type: 'LINKED_RESOURCES';
  linkedResources: {
    nodes: LinkedResource[];
  };
}

export interface WorkItemVulnerabilitiesWidget extends WorkItemWidget {
  type: 'VULNERABILITIES';
  vulnerabilities: {
    nodes: Vulnerability[];
  };
}

// Supporting types
export interface Discussion {
  id: string;
  resolvable: boolean;
  resolved: boolean;
  notes: {
    nodes: Note[];
  };
}

export interface Note {
  id: string;
  body: string;
  author: User;
  createdAt: string;
  updatedAt: string;
  system: boolean;
}

export type HealthStatusEnum = 'onTrack' | 'needsAttention' | 'atRisk';

// Supporting types for new widgets
export interface TestReport {
  id: string;
  name: string;
  status: string;
  summary: {
    total: number;
    success: number;
    failed: number;
    skipped: number;
  };
}

export interface Todo {
  id: string;
  action: string;
  author: User;
  createdAt: string;
  state: string;
}

export interface AwardEmoji {
  name: string;
  emoji: string;
  description: string;
  user: User;
}

export interface Design {
  id: string;
  filename: string;
  fullPath: string;
  image: string;
  imageV432x230: string;
}

export interface MergeRequest {
  id: string;
  iid: string;
  title: string;
  state: string;
  webUrl: string;
}

export interface FeatureFlag {
  id: string;
  name: string;
  description?: string;
  active: boolean;
}

export interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  organization?: string;
}

export interface CustomField {
  id: string;
  name: string;
  value: string;
  type: string;
}

export interface Error {
  id: string;
  title: string;
  message: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
}

export interface LinkedResource {
  id: string;
  url: string;
  type: string;
  title?: string;
}

export interface Vulnerability {
  id: string;
  title: string;
  description?: string;
  severity: string;
  state: string;
  reportType: string;
}

// GraphQL Queries

export const GET_WORK_ITEMS: TypedDocumentNode<
  { group: { workItems: { nodes: WorkItem[] } } },
  { groupPath: string; types?: WorkItemTypeEnum[]; first?: number; after?: string }
> = gql`
  query GetWorkItems($groupPath: ID!, $types: [IssueType!], $first: Int, $after: String) {
    group(fullPath: $groupPath) {
      workItems(types: $types, first: $first, after: $after) {
        nodes {
          id
          iid
          title
          description
          state
          workItemType {
            id
            name
          }
          createdAt
          updatedAt
          closedAt
          webUrl
          widgets {
            type
            ... on WorkItemWidgetAssignees {
              allowsMultipleAssignees
              canInviteMembers
              assignees {
                nodes {
                  id
                  username
                  name
                  avatarUrl
                  webUrl
                }
              }
            }
            ... on WorkItemWidgetDescription {
              description
              descriptionHtml
              edited
              lastEditedAt
              lastEditedBy {
                id
                username
                name
              }
            }
            ... on WorkItemWidgetHierarchy {
              parent {
                id
                iid
                title
                workItemType {
                  name
                }
              }
              children {
                nodes {
                  id
                  iid
                  title
                  workItemType {
                    name
                  }
                }
              }
              hasChildren
            }
            ... on WorkItemWidgetLabels {
              allowsScopedLabels
              labels {
                nodes {
                  id
                  title
                  description
                  color
                  textColor
                }
              }
            }
            ... on WorkItemWidgetMilestone {
              milestone {
                id
                title
                description
                state
                dueDate
                startDate
                webPath
              }
            }
            ... on WorkItemWidgetNotes {
              discussions {
                nodes {
                  id
                  resolvable
                  resolved
                  notes {
                    nodes {
                      id
                      body
                      author {
                        id
                        username
                        name
                      }
                      createdAt
                      updatedAt
                      system
                    }
                  }
                }
              }
            }
            ... on WorkItemWidgetStartAndDueDate {
              startDate
              dueDate
              isFixed
            }
            ... on WorkItemWidgetHealthStatus {
              healthStatus
            }
            ... on WorkItemWidgetWeight {
              weight
            }
            ... on WorkItemWidgetStatus {
              status {
                name
                color
              }
            }
            ... on WorkItemWidgetTimeTracking {
              timeEstimate
              totalTimeSpent
              humanReadableAttributes {
                timeEstimate
                totalTimeSpent
              }
            }
            ... on WorkItemWidgetParticipants {
              participants {
                nodes {
                  id
                  username
                  name
                  avatarUrl
                  webUrl
                }
              }
            }
            ... on WorkItemWidgetProgress {
              currentValue
              endValue
              progress
              startValue
            }
            ... on WorkItemWidgetRequirementLegacy {
              type
            }
            ... on WorkItemWidgetTestReports {
              testReports {
                nodes {
                  id
                  state
                  createdAt
                  author {
                    id
                    username
                  }
                }
              }
            }
            ... on WorkItemWidgetNotifications {
              subscribed
            }
            ... on WorkItemWidgetCurrentUserTodos {
              currentUserTodos {
                nodes {
                  id
                  action
                  author {
                    id
                    username
                    name
                  }
                  createdAt
                  state
                }
              }
            }
            ... on WorkItemWidgetAwardEmoji {
              awardEmoji {
                nodes {
                  name
                  emoji
                  description
                  user {
                    id
                    username
                    name
                  }
                }
              }
              upvotes
              downvotes
            }
            ... on WorkItemWidgetLinkedItems {
              linkedItems {
                nodes {
                  linkId
                  linkType
                  workItem {
                    id
                    iid
                    title
                    state
                    workItemType {
                      name
                    }
                  }
                }
              }
            }
            ... on WorkItemWidgetColor {
              color
            }
            ... on WorkItemWidgetDesigns {
              designCollection {
                designs {
                  nodes {
                    id
                    filename
                    fullPath
                    image
                    imageV432x230
                  }
                }
              }
            }
            ... on WorkItemWidgetDevelopment {
              closingMergeRequests {
                nodes {
                  id
                  mergeRequest {
                    id
                    iid
                    title
                    state
                    webUrl
                  }
                }
              }
              featureFlags {
                nodes {
                  id
                  name
                  path
                  reference
                  active
                }
              }
            }
            ... on WorkItemWidgetCrmContacts {
              contacts {
                nodes {
                  id
                  firstName
                  lastName
                  email
                  phone
                  organization {
                    id
                    name
                    description
                  }
                }
              }
            }
            ... on WorkItemWidgetEmailParticipants {
              emailParticipants {
                nodes {
                  email
                }
              }
            }
            ... on WorkItemWidgetCustomFields {
              type
            }
            ... on WorkItemWidgetErrorTracking {
              identifier
              status
            }
            ... on WorkItemWidgetLinkedResources {
              linkedResources {
                nodes {
                  url
                }
              }
            }
            ... on WorkItemWidgetVulnerabilities {
              type
            }
          }
        }
      }
    }
  }
`;

export const GET_WORK_ITEM: TypedDocumentNode<{ workItem: WorkItem }, { id: string }> = gql`
  query GetWorkItem($id: WorkItemID!) {
    workItem(id: $id) {
      id
      iid
      title
      description
      state
      workItemType {
        id
        name
      }
      createdAt
      updatedAt
      closedAt
      webUrl
      widgets {
        type
        ... on WorkItemWidgetAssignees {
          allowsMultipleAssignees
          canInviteMembers
          assignees {
            nodes {
              id
              username
              name
              avatarUrl
              webUrl
            }
          }
        }
        ... on WorkItemWidgetDescription {
          description
          descriptionHtml
          edited
          lastEditedAt
          lastEditedBy {
            id
            username
            name
          }
        }
        ... on WorkItemWidgetHierarchy {
          parent {
            id
            iid
            title
            workItemType {
              name
            }
          }
          children {
            nodes {
              id
              iid
              title
              workItemType {
                name
              }
            }
          }
          hasChildren
        }
        ... on WorkItemWidgetLabels {
          allowsScopedLabels
          labels {
            nodes {
              id
              title
              description
              color
              textColor
            }
          }
        }
      }
    }
  }
`;

// GraphQL Mutations

// Minimal work item creation (for tests)
export const CREATE_WORK_ITEM: TypedDocumentNode<
  { workItemCreate: { workItem: WorkItem; errors: string[] } },
  {
    namespacePath: string;
    title: string;
    workItemTypeId: string;
  }
> = gql`
  mutation CreateWorkItem($namespacePath: ID!, $title: String!, $workItemTypeId: WorkItemsTypeID!) {
    workItemCreate(
      input: { namespacePath: $namespacePath, title: $title, workItemTypeId: $workItemTypeId }
    ) {
      workItem {
        id
        iid
        title
        description
        state
        workItemType {
          id
          name
        }
        webUrl
      }
      errors
    }
  }
`;

// Full work item creation with optional description (for MCP registry)
export const CREATE_WORK_ITEM_WITH_DESCRIPTION: TypedDocumentNode<
  { workItemCreate: { workItem: WorkItem; errors: string[] } },
  {
    namespacePath: string;
    title: string;
    workItemTypeId: string;
    description: string;
  }
> = gql`
  mutation CreateWorkItemWithDescription(
    $namespacePath: ID!
    $title: String!
    $workItemTypeId: WorkItemsTypeID!
    $description: String!
  ) {
    workItemCreate(
      input: {
        namespacePath: $namespacePath
        title: $title
        workItemTypeId: $workItemTypeId
        descriptionWidget: { description: $description }
      }
    ) {
      workItem {
        id
        iid
        title
        description
        state
        workItemType {
          id
          name
        }
        webUrl
      }
      errors
    }
  }
`;

export const UPDATE_WORK_ITEM: TypedDocumentNode<
  { workItemUpdate: { workItem: WorkItem; errors: string[] } },
  {
    id: string;
    title?: string;
    description?: string;
    state?: WorkItemState;
    assigneeIds?: string[];
    labelIds?: string[];
    milestoneId?: string;
  }
> = gql`
  mutation UpdateWorkItem(
    $id: WorkItemID!
    $title: String
    $description: String
    $state: WorkItemState
    $assigneeIds: [UserID!]
    $labelIds: [LabelID!]
    $milestoneId: MilestoneID
  ) {
    workItemUpdate(
      input: {
        id: $id
        title: $title
        stateEvent: $state
        descriptionWidget: { description: $description }
        assigneesWidget: { assigneeIds: $assigneeIds }
        labelsWidget: { addLabelIds: $labelIds }
        milestoneWidget: { milestoneId: $milestoneId }
      }
    ) {
      workItem {
        id
        iid
        title
        description
        state
        workItemType {
          id
          name
        }
        webUrl
      }
      errors
    }
  }
`;

export const DELETE_WORK_ITEM: TypedDocumentNode<
  { workItemDelete: { errors: string[] } },
  { id: string }
> = gql`
  mutation DeleteWorkItem($id: WorkItemID!) {
    workItemDelete(input: { id: $id }) {
      errors
    }
  }
`;

export const GET_WORK_ITEM_TYPES: TypedDocumentNode<
  { namespace: { workItemTypes: { nodes: { id: string; name: string }[] } } },
  { namespacePath: string }
> = gql`
  query GetWorkItemTypes($namespacePath: ID!) {
    namespace(fullPath: $namespacePath) {
      workItemTypes {
        nodes {
          id
          name
        }
      }
    }
  }
`;
