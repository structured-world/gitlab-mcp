/**
 * Unit tests for `gitlab-mcp plugin build` argument handling and exit codes.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { parsePluginArgs, runPluginCommand } from '../../../../src/cli/plugin/command';

describe('parsePluginArgs', () => {
  it('defaults to a private package in ./gitlab-mcp-plugin', () => {
    expect(parsePluginArgs(['build', '--endpoint', 'https://mcp.example.com/mcp'])).toEqual({
      flavor: 'private',
      outDir: resolve('gitlab-mcp-plugin'),
      endpoint: 'https://mcp.example.com/mcp',
    });
  });

  it('reads every option', () => {
    expect(
      parsePluginArgs([
        'build',
        '--public',
        '--endpoint',
        'https://mcp.example.com/mcp',
        '--out',
        'dist-plugin',
        '--privacy-url',
        'https://example.com/privacy',
        '--terms-url',
        'https://example.com/terms',
      ]),
    ).toEqual({
      flavor: 'public',
      outDir: resolve('dist-plugin'),
      endpoint: 'https://mcp.example.com/mcp',
      privacyPolicyUrl: 'https://example.com/privacy',
      termsOfServiceUrl: 'https://example.com/terms',
    });
  });

  it('requires the build action', () => {
    expect(() => parsePluginArgs([])).toThrow('Usage: gitlab-mcp plugin build');
    expect(() => parsePluginArgs(['publish'])).toThrow('Usage: gitlab-mcp plugin build');
  });

  it('requires an endpoint', () => {
    expect(() => parsePluginArgs(['build', '--public'])).toThrow('--endpoint is required');
  });

  it('refuses a flag without its value and an unknown flag', () => {
    expect(() => parsePluginArgs(['build', '--endpoint'])).toThrow('--endpoint needs a value');
    expect(() => parsePluginArgs(['build', '--endpoint', '--public'])).toThrow(
      '--endpoint needs a value',
    );
    expect(() => parsePluginArgs(['build', '--endpoint', 'https://x.example', '--zip'])).toThrow(
      'Unknown option --zip',
    );
  });
});

describe('runPluginCommand', () => {
  let outDir: string;
  let lines: string[];
  let errors: string[];
  const out = (line: string) => lines.push(line);
  const err = (line: string) => errors.push(line);

  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), 'gitlab-mcp-plugin-cmd-'));
    lines = [];
    errors = [];
  });

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it('exits 2 with usage on bad arguments', () => {
    expect(runPluginCommand(['build'], out, err)).toBe(2);
    expect(errors.join('\n')).toContain('--endpoint is required');
    expect(lines).toEqual([]);
  });

  it('exits 1 and lists every problem when validation fails', () => {
    const code = runPluginCommand(
      ['build', '--public', '--endpoint', 'https://mcp.example.com/mcp', '--out', outDir],
      out,
      err,
    );
    expect(code).toBe(1);
    expect(errors[0]).toContain('interface.privacyPolicyURL is required');
    expect(errors[0]).toContain('interface.termsOfServiceURL is required');
  });

  it('exits 1 with the reason when the endpoint is refused', () => {
    const code = runPluginCommand(
      ['build', '--endpoint', 'http://mcp.example.com/mcp', '--out', outDir],
      out,
      err,
    );
    expect(code).toBe(1);
    expect(errors).toEqual([
      'Error: Endpoint must use HTTPS (plain HTTP is accepted only on loopback)',
    ]);
  });

  it('exits 0 and tells a private operator how to add the marketplace', () => {
    const code = runPluginCommand(
      ['build', '--endpoint', 'https://mcp.example.com/mcp', '--out', outDir],
      out,
      err,
    );
    expect(code).toBe(0);
    expect(errors).toEqual([]);
    expect(lines[0]).toMatch(
      /^Built gitlab-mcp plugin \d+\.\d+\.\d+ for https:\/\/mcp\.example\.com\/mcp$/,
    );
    expect(lines.join('\n')).toContain(`codex plugin marketplace add "${outDir}"`);
  });

  it('tells a public publisher to upload the ZIP', () => {
    const code = runPluginCommand(
      [
        'build',
        '--public',
        '--endpoint',
        'https://mcp.example.com/mcp',
        '--privacy-url',
        'https://example.com/privacy',
        '--terms-url',
        'https://example.com/terms',
        '--out',
        outDir,
      ],
      out,
      err,
    );
    expect(code).toBe(0);
    expect(lines.join('\n')).toContain('Upload the ZIP in the OpenAI platform dashboard');
  });
});
