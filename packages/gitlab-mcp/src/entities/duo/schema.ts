import { z } from 'zod';
import { numericId, requiredId } from '../utils';

const workflowId = z
  .string()
  .regex(
    /^(?:gid:\/\/gitlab\/Ai::DuoWorkflows::Workflow\/)?[1-9]\d*$/,
    'Expected a positive Duo workflow ID',
  )
  .describe('Duo workflow ID returned by session discovery or start');
const project = requiredId.describe('Project ID or full path');
const page = {
  first: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe('Page size, default 20, maximum 100'),
  after: z.string().optional().describe('Opaque cursor from the preceding page'),
};

export const BrowseDuoSessionsSchema = z.discriminatedUnion('action', [
  z.object({
    action: z
      .literal('agents_and_flows')
      .describe('Discover configured agents, flows and foundational agents'),
    project_id: project,
    item_type: z
      .enum(['agent', 'flow', 'third_party_flow'])
      .optional()
      .describe('Return only this catalog item type'),
    ...page,
  }),
  z.object({
    action: z
      .literal('list')
      .describe('List your sessions with project provenance and cursor pagination'),
    project_id: project.optional(),
    ...page,
  }),
  z.object({
    action: z
      .literal('get')
      .describe('Read session progress, pending input, latest answer and created objects'),
    workflow_id: workflowId,
  }),
]);

const Start = z
  .object({
    action: z
      .literal('start')
      .describe(
        'Start a real asynchronous Duo CI session that can change GitLab and consume credits',
      ),
    project_id: project,
    goal: z
      .string()
      .trim()
      .min(1)
      .describe(
        'Goal; fix_pipeline/v1 and code_review/v1 require the target pipeline or merge request URL',
      ),
    flow: z
      .string()
      .min(1)
      .optional()
      .describe('Enabled foundational flow reference returned by discovery'),
    consumer_id: numericId
      .optional()
      .describe('Configured catalog consumer ID returned by discovery, not a catalog item ID'),
    agent: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Foundational agent reference returned by discovery; GitLab Duo itself is not startable',
      ),
  })
  .superRefine((value, context) => {
    if (
      [value.flow, value.consumer_id, value.agent].filter((entry) => entry !== undefined).length !==
      1
    )
      context.addIssue({
        code: 'custom',
        message: 'Select exactly one of flow, consumer_id or agent',
      });
  });

const SendInput = z
  .object({
    action: z
      .literal('send_input')
      .describe(
        'Answer, approve or reject a waiting session; schedules another CI job and can consume credits',
      ),
    workflow_id: workflowId,
    human_approval: z
      .boolean()
      .describe('True approves a pending action; false sends an answer or rejection'),
    human_message: z
      .string()
      .max(4000)
      .refine((message) => {
        let characters = 0;
        for (const _character of message) if (++characters > 2000) return false;
        return true;
      }, 'Maximum 2000 characters')
      .meta({ maxLength: 2000 })
      .optional()
      .describe(
        'Answer or rejection feedback, maximum 2000 Unicode characters; omit when approving',
      ),
  })
  .superRefine((value, context) => {
    if (value.human_approval && value.human_message !== undefined)
      context.addIssue({ code: 'custom', message: 'Approval cannot include human_message' });
  });

export const ManageDuoSessionSchema = z.discriminatedUnion('action', [Start, SendInput]);
export type BrowseDuoSessionsInput = z.infer<typeof BrowseDuoSessionsSchema>;
export type ManageDuoSessionInput = z.infer<typeof ManageDuoSessionSchema>;
