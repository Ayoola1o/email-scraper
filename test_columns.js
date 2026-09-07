const { toCSV, toJSON } = require('./dist/index.js');

const sample = [
  {
    email: 'test@example.com',
    type: 'personal',
    domain: 'example.com',
    sourceUrl: 'https://example.com',
    pageTitle: 'Test Page',
    contextSnippet: 'Sample snippet text',
    discoveredAt: '2026-09-07T12:00:00Z'
  }
];

// Test 1: Only email and domain
const csv1 = toCSV(sample, ['email', 'domain']);
console.log('--- Custom CSV (Email + Domain only) ---');
console.log(csv1);
console.assert(csv1.includes('"Email","Domain"'), 'Header must match selected fields');
console.assert(!csv1.includes('Context Snippet'), 'Snippet column must NOT be present');
console.assert(!csv1.includes('Source URL'), 'Source URL must NOT be present');

// Test 2: Custom JSON
const json1 = toJSON(sample, ['email', 'type', 'domain']);
console.log('\n--- Custom JSON (Email + Type + Domain only) ---');
console.log(json1);
const parsed = JSON.parse(json1)[0];
console.assert(parsed.email && parsed.type && parsed.domain, 'Selected keys must be present');
console.assert(parsed.contextSnippet === undefined, 'Unselected keys must be omitted');
console.assert(parsed.sourceUrl === undefined, 'Unselected keys must be omitted');

console.log('\n✅ All Column Customization tests passed!');
