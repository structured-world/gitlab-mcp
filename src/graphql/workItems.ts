import { gql } from "graphql-tag";
import { TypedDocumentNode } from "@graphql-typed-document-node/core";

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

export enum WorkItemState {
  OPEN = "OPEN",
  CLOSED = "CLOSED",
}

export enum WorkItemTypeEnum {
  EPIC = "EPIC",
  ISSUE = "ISSUE",
  TASK = "TASK",
  INCIDENT = "INCIDENT",
  TEST_CASE = "TEST_CASE",
  REQUIREMENT = "REQUIREMENT",
  OBJECTIVE = "OBJECTIVE",
  KEY_RESULT = "KEY_RESULT",
}

export interface WorkItemWidget {
  type: WorkItemWidgetType;
}

export enum WorkItemWidgetType {
  ASSIGNEES = "ASSIGNEES",
  DESCRIPTION = "DESCRIPTION",
  HIERARCHY = "HIERARCHY",
  LABELS = "LABELS",
  MILESTONE = "MILESTONE",
  NOTES = "NOTES",
  START_AND_DUE_DATE = "START_AND_DUE_DATE",
  HEALTH_STATUS = "HEALTH_STATUS",
  WEIGHT = "WEIGHT",
  ITERATION = "ITERATION",
  PROGRESS = "PROGRESS",
  STATUS = "STATUS",
  REQUIREMENT_LEGACY = "REQUIREMENT_LEGACY",
  TEST_REPORTS = "TEST_REPORTS",
  NOTIFICATIONS = "NOTIFICATIONS",
  CURRENT_USER_TODOS = "CURRENT_USER_TODOS",
  AWARD_EMOJI = "AWARD_EMOJI",
  LINKED_ITEMS = "LINKED_ITEMS",
  COLOR = "COLOR",
}

export interface WorkItemAssigneesWidget extends WorkItemWidget {
  type: WorkItemWidgetType.ASSIGNEES;
  allowsMultipleAssignees: boolean;
  canInviteMembers: boolean;
  assignees: {
    nodes: User[];
  };
}

export interface WorkItemDescriptionWidget extends WorkItemWidget {
  type: WorkItemWidgetType.DESCRIPTION;
  description: string;
  descriptionHtml: string;
  edited: boolean;
  lastEditedAt?: string;
  lastEditedBy?: User;
}

export interface WorkItemHierarchyWidget extends WorkItemWidget {
  type: WorkItemWidgetType.HIERARCHY;
  parent?: WorkItem;
  children: {
    nodes: WorkItem[];
  };
  hasChildren: boolean;
}

export interface WorkItemLabelsWidget extends WorkItemWidget {
  type: WorkItemWidgetType.LABELS;
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

export enum MilestoneStateEnum {
  ACTIVE = "active",
  CLOSED = "closed",
}

// GraphQL Queries

export const GET_WORK_ITEMS: TypedDocumentNode<
  { group: { workItems: { nodes: WorkItem[] } } },
  { groupPath: string; types?: WorkItemTypeEnum[]; first?: number; after?: string }
> = gql`
  query GetWorkItems($groupPath: ID!, $types: [WorkItemType!], $first: Int, $after: String) {
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

export const CREATE_WORK_ITEM: TypedDocumentNode<
  { workItemCreate: { workItem: WorkItem; errors: string[] } },
  {
    namespacePath: string;
    title: string;
    workItemTypeId: string;
    description?: string;
    assigneeIds?: string[];
    labelIds?: string[];
    milestoneId?: string;
  }
> = gql`
  mutation CreateWorkItem(
    $namespacePath: ID!
    $title: String!
    $workItemTypeId: WorkItemsTypeID!
    $description: String
    $assigneeIds: [UserID!]
    $labelIds: [LabelID!]
    $milestoneId: MilestoneID
  ) {
    workItemCreate(
      input: {
        namespacePath: $namespacePath
        title: $title
        workItemTypeId: $workItemTypeId
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
