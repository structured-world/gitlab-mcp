#!/usr/bin/env node
/**
 * Upstream digest generator (monitor-only).
 *
 * Summarizes new commits on the upstream `zereight/gitlab-mcp` main branch within
 * a time window and categorizes them so a human can decide what to cherry-pick.
 * This fork is heavily diverged and is NEVER auto-merged — this is intelligence
 * only.
 *
 * Prereq: an `upstream` remote pointing at zereight/gitlab-mcp must be fetched
 * (`git remote add upstream ...; git fetch upstream main --tags`).
 *
 * Usage: node scripts/upstream-digest.mjs <sinceDays>
 * Output: a single JSON object on stdout: { hasActivity, title, body }.
 *   - hasActivity=false when no new upstream commits in the window (caller skips
 *     creating a digest issue to avoid alert fatigue).
 */

import { execSync } from 'node:child_process';

const UPSTREAM_SLUG = 'zereight/gitlab-mcp';
const sinceDays = Number.parseInt(process.argv[2] ?? '7', 10) || 7;
const since = `${sinceDays} days ago`;

function git(args) {
  try {
    return execSync(`git ${args}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

/** Parse `<sha>\t<subject>` lines into commit records (short sha + subject). */
function parseCommits(raw) {
  if (!raw) return [];
  return raw.split('\n').map((line) => {
    const tab = line.indexOf('\t');
    return { sha: line.slice(0, tab).slice(0, 7), subject: line.slice(tab + 1) };
  });
}

/** Turn a trailing PR ref like "(#382)" into an upstream-qualified link. */
function linkSubject(subject) {
  return subject.replace(/\(#(\d+)\)/g, (_m, n) => `(${UPSTREAM_SLUG}#${n})`);
}

const SECURITY_RE = /security|CVE-|vuln|sanitiz|injection|XSS|SSRF|RCE|auth bypass/i;

/** Bucket a commit by conventional-commit type + security heuristics. */
function categorize({ subject }) {
  if (SECURITY_RE.test(subject)) return 'security';
  if (/^feat(\(|!|:)/i.test(subject)) return 'feat';
  if (/^fix(\(|!|:)/i.test(subject)) return 'fix';
  if (/^docs(\(|:)/i.test(subject)) return 'docs';
  return 'other';
}

const commits = parseCommits(
  git(`log upstream/main --no-merges --since="${since}" --pretty=format:%H%x09%s`),
);

if (commits.length === 0) {
  process.stdout.write(JSON.stringify({ hasActivity: false, title: '', body: '' }));
  process.exit(0);
}

const buckets = { security: [], feat: [], fix: [], docs: [], other: [] };
for (const c of commits) buckets[categorize(c)].push(c);

// Latest upstream tag reachable from upstream/main (release intelligence).
// Upstream tags are fetched under an `upstream-` namespace to avoid clobbering
// this fork's own release tags; strip it for display.
const latestTag = git('describe --tags --abbrev=0 upstream/main').replace(/^upstream-/, '');

const today = git('log -1 --format=%cs upstream/main') || new Date().toISOString().slice(0, 10);

const section = (emoji, heading, list, note) => {
  if (list.length === 0) return '';
  const lines = list.map((c) => `- \`${c.sha}\` ${linkSubject(c.subject)}`).join('\n');
  return `\n### ${emoji} ${heading}${note ? ` ${note}` : ''}\n${lines}\n`;
};

const body =
  `## Upstream digest — last ${sinceDays} days (as of ${today})\n\n` +
  `Upstream: [\`${UPSTREAM_SLUG}\`](https://github.com/${UPSTREAM_SLUG})` +
  (latestTag ? ` · latest tag \`${latestTag}\`` : '') +
  `\nNew commits on \`upstream/main\`: **${commits.length}**\n` +
  section('🔒', 'Security (cherry-pick recommended)', buckets.security) +
  section('✨', 'New features / tools (evaluate)', buckets.feat) +
  section('🐛', 'Bug fixes (cherry-pick candidates)', buckets.fix) +
  section('📝', 'Docs', buckets.docs) +
  section('📦', 'Other', buckets.other) +
  `\n### Action needed\n` +
  `- [ ] Review security fixes for cherry-pick\n` +
  `- [ ] Evaluate new features/tools — do we already have equivalents?\n` +
  `- [ ] Cherry-pick relevant bug fixes (paths differ from this fork — port, don't merge)\n` +
  `- [ ] Close this issue when reviewed\n\n` +
  `> Monitor-only: this fork is heavily diverged and is never auto-merged.\n`;

const title = `Upstream digest: ${commits.length} new commit${commits.length === 1 ? '' : 's'}${latestTag ? ` (latest ${latestTag})` : ''} — ${today}`;

process.stdout.write(JSON.stringify({ hasActivity: true, title, body }));
