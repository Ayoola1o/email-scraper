const assert = require('assert');
const { parseEmailList } = require('./dist/utils/importer');
const { verifyEmailRecords } = require('./dist/utils/verifier');

async function testImporter() {
  console.log('🧪 Starting Email List Import & Verification Test Suite...\n');

  // Test 1: CSV with headers
  console.log('Test 1: CSV with standard headers (email, name, company, job title)...');
  const csvData = `Email,Full Name,Company,Title,Phone
alex.smith@cloudflare.com,"Smith, Alex",Cloudflare,VP Engineering,+14155550100
elena@google.com,Elena Rostova,Google,Director,+18005550199
temp.user@mailinator.com,Temp User,Disposable Org,Tester,
bad-email-without-at.com,Broken User,Unknown,Lead,
fakeuser@thishostnamedefinitelydoesnotexist991823.xyz,Fake User,Fake Inc,Tester,
alex.smith@cloudflare.com,Duplicate Alex,Cloudflare,VP Engineering,
`;

  const parsedCsv = parseEmailList(csvData, { sourceName: 'test.csv' });
  assert.strictEqual(parsedCsv.detectedFormat, 'csv', 'Should detect CSV format');
  assert.strictEqual(parsedCsv.records.length, 4, 'Should parse 4 unique valid syntax emails (1 duplicate skipped, 1 bad syntax skipped)');
  assert.strictEqual(parsedCsv.duplicateCount, 1, 'Should identify 1 duplicate');
  assert.strictEqual(parsedCsv.invalidCount, 1, 'Should identify 1 syntax error');
  assert.strictEqual(parsedCsv.records[0].company, 'Cloudflare');
  assert.strictEqual(parsedCsv.records[0].name, 'Smith, Alex');
  console.log('   ✓ Test 1 passed: CSV with headers parsed accurately with deduplication and metadata.');

  // Test 2: Plain text list (one per line)
  console.log('\nTest 2: Plain text list (one email per line)...');
  const txtData = `
    info@github.com
    support@stripe.com
    invalid..email@bad
    marcus.vance@techcorp.io
  `;
  const parsedTxt = parseEmailList(txtData);
  assert.strictEqual(parsedTxt.records.length, 3, 'Should find 3 valid emails');
  assert.strictEqual(parsedTxt.records[0].type, 'role', 'info@github.com should be role-based');
  assert.strictEqual(parsedTxt.records[2].name, 'Marcus Vance', 'Should infer name from marcus.vance');
  console.log('   ✓ Test 2 passed: Plain text parsed, role detected, and name inferred.');

  // Test 3: JSON format
  console.log('\nTest 3: JSON format import...');
  const jsonData = JSON.stringify([
    { email: 'sarah.connor@sky.net', name: 'Sarah Connor', company: 'Resistance' },
    { email: 'john.doe@gmail.com', name: 'John Doe', company: 'Freelance' }
  ]);
  const parsedJson = parseEmailList(jsonData);
  assert.strictEqual(parsedJson.detectedFormat, 'json', 'Should detect JSON format');
  assert.strictEqual(parsedJson.records.length, 2);
  assert.strictEqual(parsedJson.records[1].emailCategory, 'Personal', 'Gmail should be categorized as Personal');
  console.log('   ✓ Test 3 passed: JSON format imported with correct categorization.');

  // Test 4: Live MX Verification on Imported List
  console.log('\nTest 4: Live MX verification on imported records...');
  const testBatch = [
    { email: 'test@cloudflare.com', domain: 'cloudflare.com', type: 'role', sourceUrl: 'test', discoveredAt: new Date().toISOString() },
    { email: 'disposable@mailinator.com', domain: 'mailinator.com', type: 'personal', sourceUrl: 'test', discoveredAt: new Date().toISOString() },
    { email: 'dead@thishostnamedefinitelydoesnotexist991823.xyz', domain: 'thishostnamedefinitelydoesnotexist991823.xyz', type: 'personal', sourceUrl: 'test', discoveredAt: new Date().toISOString() }
  ];

  const verified = await verifyEmailRecords(testBatch);
  const cf = verified.find(r => r.domain === 'cloudflare.com');
  const disp = verified.find(r => r.domain === 'mailinator.com');
  const dead = verified.find(r => r.domain === 'thishostnamedefinitelydoesnotexist991823.xyz');

  assert.strictEqual(cf.mxStatus, 'deliverable', 'cloudflare.com should be deliverable');
  assert.strictEqual(disp.mxStatus, 'disposable', 'mailinator.com should be disposable');
  assert.strictEqual(dead.mxStatus, 'undeliverable', 'fake domain should be undeliverable');
  console.log('   ✓ Test 4 passed: Live MX verification accurately classifies deliverable, disposable, and undeliverable.');

  console.log('\n🎉 All Import & Verification Tests Passed Successfully!\n');
}

testImporter().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
