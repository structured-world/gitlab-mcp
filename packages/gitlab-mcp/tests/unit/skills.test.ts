import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { ManageContextSchema } from '../../src/entities/context/schema';
import { BrowseProjectsSchema } from '../../src/entities/core/schema-readonly';
import {
  BrowseMergeRequestsSchema,
  BrowseMrDiscussionsSchema,
} from '../../src/entities/mrs/schema-readonly';
import { ManageMrDiscussionSchema } from '../../src/entities/mrs/schema';
import { BrowseWorkItemsSchema } from '../../src/entities/workitems/schema-readonly';
import { ManageWorkItemSchema } from '../../src/entities/workitems/schema';
import { BrowsePipelinesSchema } from '../../src/entities/pipelines/schema-readonly';
import { ManageFilesSchema } from '../../src/entities/files/schema';
import { BrowseFilesSchema } from '../../src/entities/files/schema-readonly';
import { BrowseDuoSessionsSchema, ManageDuoSessionSchema } from '../../src/entities/duo/schema';
import { RegistryManager } from '../../src/registry-manager';
import { compileProjection, JMESPATH_ARGUMENT } from '../../src/utils/jmespath-projection';
import type { ZodType } from 'zod';

const schemas: Record<string, Array<[string, ZodType]>> = {
  'gitlab-setup': [['manage_context', ManageContextSchema]],
  'gitlab-discovery': [
    ['manage_context', ManageContextSchema],
    ['browse_projects', BrowseProjectsSchema],
  ],
  'gitlab-review': [
    ['browse_merge_requests', BrowseMergeRequestsSchema],
    ['browse_mr_discussions', BrowseMrDiscussionsSchema],
    ['manage_mr_discussion', ManageMrDiscussionSchema],
    ['browse_files', BrowseFilesSchema],
  ],
  'gitlab-work-items': [
    ['browse_work_items', BrowseWorkItemsSchema],
    ['manage_work_item', ManageWorkItemSchema],
  ],
  'gitlab-ci': [
    ['browse_pipelines', BrowsePipelinesSchema],
    ['manage_files', ManageFilesSchema],
    ['browse_files', BrowseFilesSchema],
  ],
  'gitlab-duo': [
    ['browse_duo_sessions', BrowseDuoSessionsSchema],
    ['manage_duo_session', ManageDuoSessionSchema],
  ],
};

describe('portable installed skills', () => {
  it('includes the full workflow directory in the npm artifact', () => {
    // Distributing only dist would leave the plugin with no installable workflows.
    const manifest = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8'));
    expect(manifest.files).toContain('skills');
    expect(readdirSync(resolve(__dirname, '../../skills')).sort()).toEqual(
      Object.keys(schemas).sort(),
    );
  });

  it.each(Object.entries(schemas))('%s uses valid installed-tool examples', (name, candidates) => {
    // Validate examples against real public input schemas, including unknown keys,
    // so documentation cannot silently teach a parameter Zod would discard.
    const source = readFileSync(resolve(__dirname, '../../skills', name, 'SKILL.md'), 'utf8');
    const frontmatter = parse(source.split('---')[1]);
    expect(frontmatter.name).toBe(name);
    expect(frontmatter.description).toMatch(/GitLab/);
    expect(source).not.toMatch(/\/Users\/|~\/|GITLAB_TOKEN\s*=/);
    const examples = [...source.matchAll(/`(\{"action":.*?\})`/g)].map((match) =>
      JSON.parse(match[1]),
    );
    expect(examples.length).toBeGreaterThan(0);
    for (const example of examples) {
      // A projection is taken off the call before the tool's schema reads it, so it is
      // checked against the actions that accept it and compiled instead.
      const { [JMESPATH_ARGUMENT]: projection, ...toolArgs } = example as Record<string, unknown>;
      const match = candidates
        .map(([tool, schema]) => ({ tool, parsed: schema.safeParse(toolArgs) }))
        .find(({ parsed }) => parsed.success);
      expect(match?.parsed.success).toBe(true);
      if (match?.parsed.success) {
        for (const key of Object.keys(toolArgs)) expect(match.parsed.data).toHaveProperty(key);
        if (projection !== undefined) {
          expect({ tool: match.tool, action: toolArgs.action, accepts: true }).toEqual({
            tool: match.tool,
            action: toolArgs.action,
            accepts: RegistryManager.getInstance().acceptsProjection(match.tool, toolArgs.action),
          });
          expect(() => compileProjection(String(projection))).not.toThrow();
        }
      }
    }
  });
});
