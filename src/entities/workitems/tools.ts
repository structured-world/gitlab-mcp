import { zodToJsonSchema } from "zod-to-json-schema";
import { CreateWorkItemSchema, UpdateWorkItemSchema, DeleteWorkItemSchema } from "./schema";
import { ToolDefinition } from "../../types";

export const workitemsWriteTools: ToolDefinition[] = [
  {
    name: "create_work_item",
    description: "Create a new work item (epic, issue, task, etc.) in a GitLab group",
    inputSchema: zodToJsonSchema(CreateWorkItemSchema),
  },
  {
    name: "update_work_item",
    description: "Update an existing work item's properties",
    inputSchema: zodToJsonSchema(UpdateWorkItemSchema),
  },
  {
    name: "delete_work_item",
    description: "Delete a work item",
    inputSchema: zodToJsonSchema(DeleteWorkItemSchema),
  },
];
