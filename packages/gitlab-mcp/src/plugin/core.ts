import { startServer, gracefulShutdown } from '../server';

// The connector supplies this process's configuration; standalone CLI profiles do not select its target.
process.stdin.once('end', () => {
  void gracefulShutdown('stdin closed').catch(() => process.exit(1));
});
void startServer().catch(() => {
  console.error('The local GitLab core could not start.');
  process.exit(1);
});
