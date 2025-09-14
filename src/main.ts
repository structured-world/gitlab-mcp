#!/usr/bin/env node

import { startServer } from './server';

// Start the server
startServer().catch((error: unknown) => {
  console.error('Failed to start GitLab MCP Server:', error);
  process.exit(1);
});
