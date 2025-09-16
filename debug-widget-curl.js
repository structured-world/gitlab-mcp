#!/usr/bin/env node
require('dotenv').config({ path: '.env.test' });

const GITLAB_TOKEN = process.env.GITLAB_TOKEN;
const GITLAB_API_URL = process.env.GITLAB_API_URL;

if (!GITLAB_TOKEN || !GITLAB_API_URL) {
    console.error('Missing GITLAB_TOKEN or GITLAB_API_URL in .env.test');
    process.exit(1);
}

async function debugWidgetAssignment() {
    console.log('🔍 Debug Widget Assignment with Direct API Calls\n');

    try {
        // Step 1: Get current user
        console.log('1️⃣ Getting current user...');
        const userResponse = await fetch(`${GITLAB_API_URL}/api/v4/user`, {
            headers: { 'Authorization': `Bearer ${GITLAB_TOKEN}` }
        });
        const user = await userResponse.json();
        console.log(`✅ Current user: ${user.username} (ID: ${user.id})`);
        const userGid = `gid://gitlab/User/${user.id}`;

        // Step 2: Create a simple group
        console.log('\n2️⃣ Creating test group...');
        const groupResponse = await fetch(`${GITLAB_API_URL}/api/v4/groups`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GITLAB_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: `debug-widget-${Date.now()}`,
                path: `debug-widget-${Date.now()}`,
                visibility: 'private'
            })
        });
        const group = await groupResponse.json();
        console.log(`✅ Created group: ${group.name} (ID: ${group.id})`);

        // Step 3: Create a project in the group
        console.log('\n3️⃣ Creating project in group...');
        const projectResponse = await fetch(`${GITLAB_API_URL}/api/v4/projects`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GITLAB_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: `debug-project-${Date.now()}`,
                path: `debug-project-${Date.now()}`,
                namespace_id: group.id,
                visibility: 'private'
            })
        });
        const project = await projectResponse.json();
        console.log(`✅ Created project: ${project.name} (ID: ${project.id})`);

        // Step 4: Create a work item (Issue)
        console.log('\n4️⃣ Creating Issue work item...');
        const createWorkItemQuery = `
            mutation {
                workItemCreate(input: {
                    namespacePath: "${project.path_with_namespace}",
                    title: "Debug Issue for Widget Testing",
                    workItemTypeId: "gid://gitlab/WorkItems::Type/1"
                }) {
                    workItem {
                        id
                        iid
                        title
                        widgets {
                            type
                            ... on WorkItemWidgetAssignees {
                                assignees {
                                    nodes {
                                        id
                                        username
                                    }
                                }
                            }
                        }
                    }
                    errors
                }
            }
        `;

        const createResponse = await fetch(`${GITLAB_API_URL}/api/graphql`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GITLAB_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ query: createWorkItemQuery })
        });
        const createResult = await createResponse.json();

        if (createResult.errors) {
            console.error('❌ GraphQL errors:', createResult.errors);
            return;
        }

        const workItem = createResult.data.workItemCreate.workItem;
        console.log(`✅ Created work item: ${workItem.title} (ID: ${workItem.id})`);
        console.log(`📋 Current assignees: ${workItem.widgets.find(w => w.type === 'ASSIGNEES')?.assignees?.nodes?.length || 0}`);

        // Step 5: Test assignee assignment with GraphQL
        console.log('\n5️⃣ Testing assignee assignment with GraphQL...');
        const updateQuery = `
            mutation UpdateWorkItem($input: WorkItemUpdateInput!) {
                workItemUpdate(input: $input) {
                    workItem {
                        id
                        title
                        widgets {
                            type
                            ... on WorkItemWidgetAssignees {
                                assignees {
                                    nodes {
                                        id
                                        username
                                        name
                                    }
                                }
                            }
                        }
                    }
                    errors
                }
            }
        `;

        const variables = {
            input: {
                id: workItem.id,
                assigneesWidget: {
                    assigneeIds: [userGid]
                }
            }
        };

        console.log('📤 GraphQL Variables:', JSON.stringify(variables, null, 2));

        const updateResponse = await fetch(`${GITLAB_API_URL}/api/graphql`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GITLAB_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                query: updateQuery,
                variables: variables
            })
        });

        const updateResult = await updateResponse.json();
        console.log('📥 GraphQL Response:', JSON.stringify(updateResult, null, 2));

        if (updateResult.errors) {
            console.error('❌ GraphQL update errors:', updateResult.errors);
        } else {
            const updatedWorkItem = updateResult.data.workItemUpdate.workItem;
            const assignees = updatedWorkItem.widgets.find(w => w.type === 'ASSIGNEES')?.assignees?.nodes || [];
            console.log(`✅ Update successful! Assignees: ${assignees.length}`);
            assignees.forEach(a => console.log(`   - ${a.username} (${a.id})`));
        }

        // Step 6: Generate curl command for manual testing
        console.log('\n6️⃣ Curl command for manual testing:');
        const curlCommand = `curl -X POST \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${GITLAB_TOKEN}" \\
  -d '${JSON.stringify({
    query: updateQuery.replace(/\s+/g, ' ').trim(),
    variables: variables
  })}' \\
  ${GITLAB_API_URL}/api/graphql`;

        console.log(curlCommand);

        // Cleanup
        console.log('\n🧹 Cleaning up...');
        await fetch(`${GITLAB_API_URL}/api/v4/groups/${group.id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${GITLAB_TOKEN}` }
        });
        console.log('✅ Cleanup complete');

    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

debugWidgetAssignment();