import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

// Observe the installed server's wire messages without changing their bytes.
const [entry, recording] = process.argv.slice(2);
if (!entry || !recording) throw new Error('Expected installed entry and recording path');
const child = spawn(process.execPath, [entry, 'stdio'], { stdio: ['pipe', 'pipe', 'inherit'] });
process.stdin.pipe(child.stdin);
child.stdout.pipe(process.stdout);
for (const [direction, stream] of [
  ['request', process.stdin],
  ['response', child.stdout],
]) {
  createInterface({ input: stream }).on('line', (line) => {
    appendFileSync(recording, JSON.stringify({ direction, message: JSON.parse(line) }) + '\n');
  });
}
process.on('SIGTERM', () => child.kill('SIGTERM'));
child.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on('close', (code) => {
  process.stdin.destroy();
  process.exitCode = code === null ? 1 : code;
});
