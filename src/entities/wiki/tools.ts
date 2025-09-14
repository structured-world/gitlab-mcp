import { zodToJsonSchema } from 'zod-to-json-schema';
import { CreateWikiPageSchema, UpdateWikiPageSchema, DeleteWikiPageSchema } from './schema';
import { ToolDefinition } from '../../types';

export const wikiWriteTools: ToolDefinition[] = [
  {
    name: 'create_wiki_page',
    description: 'Create a new wiki page in a GitLab project',
    inputSchema: zodToJsonSchema(CreateWikiPageSchema),
  },
  {
    name: 'update_wiki_page',
    description: 'Update an existing wiki page in a GitLab project',
    inputSchema: zodToJsonSchema(UpdateWikiPageSchema),
  },
  {
    name: 'delete_wiki_page',
    description: 'Delete a wiki page from a GitLab project',
    inputSchema: zodToJsonSchema(DeleteWikiPageSchema),
  },
];
