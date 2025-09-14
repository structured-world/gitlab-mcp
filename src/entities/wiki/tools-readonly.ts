import { zodToJsonSchema } from 'zod-to-json-schema';
import { ListWikiPagesSchema, GetWikiPageSchema } from './schema-readonly';
import { ToolDefinition } from '../../types';

export const wikiReadOnlyToolsArray: ToolDefinition[] = [
  {
    name: 'list_wiki_pages',
    description: 'List wiki pages in a GitLab project',
    inputSchema: zodToJsonSchema(ListWikiPagesSchema),
  },
  {
    name: 'get_wiki_page',
    description: 'Get details of a specific wiki page',
    inputSchema: zodToJsonSchema(GetWikiPageSchema),
  },
];

export const wikiReadOnlyTools = ['list_wiki_pages', 'get_wiki_page'];
