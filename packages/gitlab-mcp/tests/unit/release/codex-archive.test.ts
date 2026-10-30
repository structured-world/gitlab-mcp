import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

test('the prepared Codex archive is qualified before irreversible package publication', () => {
  // A broken standalone archive must not leave a version already published to npm.
  const workflow = parse(
    readFileSync(join(__dirname, '../../../../../.github/workflows/release-please.yml'), 'utf8'),
  );
  const steps = workflow.jobs['post-release'].steps as {
    run?: string;
    if?: unknown;
    'continue-on-error'?: unknown;
  }[];
  const prepare = steps.findIndex((step) => step.run?.includes('scripts/prepare-release.sh'));
  const build = steps.findIndex((step) => step.run?.includes('scripts/build-codex-plugin.mjs'));
  const verify = steps.findIndex((step) =>
    step.run?.includes('scripts/qualify-codex-plugin.mjs --archive'),
  );
  const publications = steps.flatMap((step, index) =>
    step.run?.includes('npm publish') ? [index] : [],
  );
  expect(prepare).toBeGreaterThanOrEqual(0);
  expect(build).toBeGreaterThan(prepare);
  expect(verify).toBeGreaterThan(build);
  expect(steps[verify].if).toBeUndefined();
  expect(steps[verify]['continue-on-error']).toBeUndefined();
  expect(publications.length).toBeGreaterThan(0);
  for (const publication of publications) expect(publication).toBeGreaterThan(verify);
});
