#!/usr/bin/env node
/**
 * Automated Environment Gating Test Runner
 * Tests different GitLab feature flag combinations automatically
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ORIGINAL_ENV_FILE = path.resolve(__dirname, '../../.env.test');
const BACKUP_ENV_FILE = path.resolve(__dirname, '../../.env.test.backup');

// Test configurations for different GitLab tiers
const testConfigurations = [
  {
    name: 'Basic GitLab (Free tier)',
    flags: {
      USE_WORKITEMS: 'false',
      USE_MILESTONE: 'false',
      USE_PIPELINE: 'false',
      USE_GITLAB_WIKI: 'false'
    }
  },
  {
    name: 'GitLab with Work Items',
    flags: {
      USE_WORKITEMS: 'true',
      USE_MILESTONE: 'false',
      USE_PIPELINE: 'false',
      USE_GITLAB_WIKI: 'false'
    }
  },
  {
    name: 'GitLab with Work Items + Milestones',
    flags: {
      USE_WORKITEMS: 'true',
      USE_MILESTONE: 'true',
      USE_PIPELINE: 'false',
      USE_GITLAB_WIKI: 'false'
    }
  },
  {
    name: 'GitLab with Work Items + Milestones + Pipelines',
    flags: {
      USE_WORKITEMS: 'true',
      USE_MILESTONE: 'true',
      USE_PIPELINE: 'true',
      USE_GITLAB_WIKI: 'false'
    }
  },
  {
    name: 'Full GitLab (All features)',
    flags: {
      USE_WORKITEMS: 'true',
      USE_MILESTONE: 'true',
      USE_PIPELINE: 'true',
      USE_GITLAB_WIKI: 'true'
    }
  }
];

async function backupOriginalEnv() {
  if (fs.existsSync(ORIGINAL_ENV_FILE)) {
    fs.copyFileSync(ORIGINAL_ENV_FILE, BACKUP_ENV_FILE);
    console.log('✅ Backed up original .env.test file');
  }
}

async function restoreOriginalEnv() {
  if (fs.existsSync(BACKUP_ENV_FILE)) {
    fs.copyFileSync(BACKUP_ENV_FILE, ORIGINAL_ENV_FILE);
    fs.unlinkSync(BACKUP_ENV_FILE);
    console.log('✅ Restored original .env.test file');
  }
}

function createEnvFileWithFlags(flags) {
  if (!fs.existsSync(BACKUP_ENV_FILE)) {
    throw new Error('No backup .env.test file found. Please run this script from the project root with .env.test present.');
  }

  // Read the backup file
  let envContent = fs.readFileSync(BACKUP_ENV_FILE, 'utf8');

  // Update or add feature flags
  Object.entries(flags).forEach(([key, value]) => {
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (envContent.match(regex)) {
      envContent = envContent.replace(regex, `${key}=${value}`);
    } else {
      envContent += `\\n${key}=${value}`;
    }
  });

  // Write the modified content
  fs.writeFileSync(ORIGINAL_ENV_FILE, envContent);
}

function runTests(configName) {
  console.log(`\\n🧪 Running tests for: ${configName}`);
  console.log('=' .repeat(50));

  try {
    // Run integration tests
    execSync('yarn test:integration', {
      stdio: 'inherit',
      cwd: path.resolve(__dirname, '../..')
    });
    console.log(`✅ ${configName}: PASSED`);
    return true;
  } catch (error) {
    console.log(`❌ ${configName}: FAILED`);
    console.log(`Error: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('🚀 Starting Environment Gating Test Runner');
  console.log('This will test different GitLab feature flag combinations\\n');

  if (!fs.existsSync(ORIGINAL_ENV_FILE)) {
    console.error('❌ .env.test file not found. Please create it first to run integration tests.');
    process.exit(1);
  }

  const results = [];

  try {
    // Backup original environment
    await backupOriginalEnv();

    // Run tests for each configuration
    for (const config of testConfigurations) {
      console.log(`\\n📝 Setting up environment for: ${config.name}`);
      console.log('Feature flags:', Object.entries(config.flags).map(([k, v]) => `${k}=${v}`).join(', '));

      // Create environment file with specific flags
      createEnvFileWithFlags(config.flags);

      // Run tests
      const passed = runTests(config.name);
      results.push({ name: config.name, passed });

      // Wait a bit between test runs
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

  } catch (error) {
    console.error('❌ Test runner failed:', error.message);
    process.exit(1);
  } finally {
    // Always restore original environment
    await restoreOriginalEnv();
  }

  // Print summary
  console.log('\\n' + '='.repeat(60));
  console.log('📊 ENVIRONMENT GATING TEST SUMMARY');
  console.log('='.repeat(60));

  results.forEach(result => {
    const status = result.passed ? '✅ PASSED' : '❌ FAILED';
    console.log(`${status} - ${result.name}`);
  });

  const passedCount = results.filter(r => r.passed).length;
  const totalCount = results.length;

  console.log(`\\n🎯 Overall: ${passedCount}/${totalCount} configurations passed`);

  if (passedCount === totalCount) {
    console.log('🎉 All environment configurations work correctly!');
    process.exit(0);
  } else {
    console.log('⚠️  Some configurations failed. Please check the logs above.');
    process.exit(1);
  }
}

// Handle cleanup on exit
process.on('SIGINT', async () => {
  console.log('\\n🛑 Interrupted. Restoring original environment...');
  await restoreOriginalEnv();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\\n🛑 Terminated. Restoring original environment...');
  await restoreOriginalEnv();
  process.exit(0);
});

main().catch(console.error);