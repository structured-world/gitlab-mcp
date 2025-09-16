#!/usr/bin/env node
require('dotenv').config({ path: '.env.test' });

async function testWidgetAssignment() {
  console.log('🔍 Testing Widget Assignment with GitLab MCP Integration');

  const { IntegrationTestHelper } = require('./dist/tests/integration/helpers/registry-helper.js');

  try {
    const helper = new IntegrationTestHelper();
    await helper.initialize();

    console.log('✅ Helper initialized');

    // Step 1: Create a test work item
    console.log('1️⃣ Creating work item...');
    const workItem = await helper.createWorkItem({
      namespacePath: 'test/debug-project-1757990559683', // Use existing project from curl test
      title: 'Debug Widget Test Work Item',
      workItemType: 'ISSUE',
      description: 'Testing widget assignment directly'
    });

    console.log('✅ Work item created:', JSON.stringify(workItem, null, 2));

    if (!workItem || !workItem.id) {
      throw new Error('Work item creation failed - no ID returned');
    }

    // Step 2: Assign widget
    console.log('2️⃣ Assigning widget...');
    const updatedWorkItem = await helper.updateWorkItem({
      id: workItem.id,
      assigneeIds: ['gid://gitlab/User/2'] // Use the user ID we know exists
    });

    console.log('✅ Widget assignment result:', JSON.stringify(updatedWorkItem, null, 2));

    // Step 3: Verify assignment
    const assigneesWidget = updatedWorkItem?.widgets?.find(w => w.type === 'ASSIGNEES');
    const assigneeCount = assigneesWidget?.assignees?.nodes?.length || 0;

    console.log(`📊 Final result: ${assigneeCount} assignees`);

    if (assigneeCount > 0) {
      console.log('🎉 SUCCESS: Widget assignment works!');
    } else {
      console.log('❌ FAILED: Widget assignment did not work');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Stack:', error.stack);
  }
}

testWidgetAssignment();