import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import * as ts from 'typescript';

describe('wiki integration test registration', () => {
  // Free instances must still test project wikis without attempting paid group-wiki calls.
  it.each(['free', 'premium', 'ultimate', 'unknown'])(
    'registers the supported wiki scenarios on %s',
    (tier) => {
      const names: string[] = [];
      const register = Object.assign((name: string) => names.push(name), {
        each: (rows: string[][]) => (name: string) => {
          for (const row of rows) {
            let index = 0;
            names.push(name.replace(/%s/g, () => row[index++]));
          }
        },
      });
      const source = fs.readFileSync(
        path.resolve(__dirname, '../../../integration/schemas/wiki.test.ts'),
        'utf8',
      );
      const compiled = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS },
      });
      vm.runInNewContext(compiled.outputText, {
        exports: {},
        require: () => ({
          describeIfTier: (required: string, _name: string, body: () => void) => {
            expect(['free', 'premium']).toContain(required);
            if (required === 'free' || tier !== 'free') body();
          },
        }),
        describe: (_name: string, body: () => void) => body(),
        beforeAll: () => {},
        it: register,
      });
      const scenarios = names.filter((name) => name.startsWith('keeps title-less'));
      expect(scenarios.filter((name) => name.includes('project'))).toHaveLength(2);
      expect(scenarios.filter((name) => name.includes('group'))).toHaveLength(
        tier === 'free' ? 0 : 2,
      );
    },
  );
});
