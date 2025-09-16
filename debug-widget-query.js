const { UPDATE_WORK_ITEM } = require('./dist/graphql/workItems.js');

console.log('GraphQL UPDATE_WORK_ITEM mutation:');
console.log(UPDATE_WORK_ITEM.loc?.source?.body || 'Query source not available');

console.log('\nExample variables for assignee widget update:');
const exampleVariables = {
  input: {
    id: "gid://gitlab/WorkItem/123",
    assigneesWidget: {
      assigneeIds: ["gid://gitlab/User/456"]
    }
  }
};

console.log(JSON.stringify(exampleVariables, null, 2));

console.log('\nCurl command example:');
console.log(`curl -X POST \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_TOKEN" \\
  -d '{
    "query": "${UPDATE_WORK_ITEM.loc?.source?.body?.replace(/\n/g, '\\n').replace(/"/g, '\\"') || 'QUERY_NOT_AVAILABLE'}",
    "variables": ${JSON.stringify(exampleVariables)}
  }' \\
  https://git.phantom-traffic.com/api/graphql`);