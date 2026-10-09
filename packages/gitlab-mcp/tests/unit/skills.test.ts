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

const schemas = {
  'gitlab-setup': [ManageContextSchema],
  'gitlab-discovery': [ManageContextSchema, BrowseProjectsSchema],
  'gitlab-review': [BrowseMergeRequestsSchema, BrowseMrDiscussionsSchema, ManageMrDiscussionSchema],
  'gitlab-work-items': [BrowseWorkItemsSchema, ManageWorkItemSchema],
  'gitlab-ci': [BrowsePipelinesSchema],
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
      const parsed = candidates
        .map((schema) => schema.safeParse(example))
        .find((result) => result.success);
      expect(parsed?.success).toBe(true);
      if (parsed?.success) {
        for (const key of Object.keys(example)) expect(parsed.data).toHaveProperty(key);
      }
    }
  });
});
