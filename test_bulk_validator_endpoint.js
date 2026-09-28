const assert = require('assert');
const { app } = require('./dist/server/index');

async function testBulkEndpoint() {
  console.log('Testing POST /api/validator/bulk with CSV content...');

  const server = app.listen(3099);
  await new Promise(resolve => setTimeout(resolve, 500));

  try {
    const csvContent = `Email,Name,Company
alex.smith+test@google.com,Alex Smith,Google
bad.syntax..dots@test.invalid,Bad Syntax,Fake
disposable@mailinator.com,Temp User,Disposable Inc
typo.user@gmial.com,Typo User,Typo Corp`;

    const response = await fetch('http://127.0.0.1:3099/api/validator/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csv: csvContent })
    });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  console.log('API Response status:', data.success);
  console.log('Total processed:', data.totalProcessed);
  console.log('Deliverable count:', data.deliverableCount);
  console.log('Undeliverable count:', data.undeliverableCount);
  console.log('Disposable count:', data.disposableCount);
  console.log('Layer 1 Filter Rate:', data.layer1FilterRate);

  assert.strictEqual(data.success, true);
  assert.strictEqual(data.totalProcessed, 4);
  assert(Array.isArray(data.outputs), 'Outputs array must be returned');
  assert.strictEqual(data.outputs.length, 4);

  // 1. Verify Google output
  const googleOutput = data.outputs.find(o => o.email.startsWith('alex.smith'));
  assert(googleOutput, 'Google output must exist');
  assert.strictEqual(googleOutput.canonicalDeduplicationForm, 'alex.smith@google.com');
  assert(googleOutput.mxEnrichment, 'MX enrichment block must exist');
  assert(googleOutput.mxEnrichment.asn, 'ASN must exist in MX enrichment block');
  console.log('Google output MX enrichment block:', googleOutput.mxEnrichment);

  // 2. Verify Disposable output
  const disposableOutput = data.outputs.find(o => o.email.includes('mailinator'));
  assert(disposableOutput, 'Disposable output must exist');
  assert.strictEqual(disposableOutput.mailboxStatus, 'disposable');
  assert.strictEqual(disposableOutput.intelligenceFlags.isDisposable, true);

  // 3. Verify Typo output
  const typoOutput = data.outputs.find(o => o.email.includes('gmial.com'));
  assert(typoOutput, 'Typo output must exist');
  assert.strictEqual(typoOutput.typoSuggestion, 'typo.user@gmail.com');

  // 4. Verify Syntax Error output
  const syntaxOutput = data.outputs.find(o => o.email.includes('test.invalid'));
  assert(syntaxOutput, 'Syntax output must exist');
  assert.strictEqual(syntaxOutput.mailboxStatus, 'undeliverable');
  assert(syntaxOutput.intelligenceFlags.staticChecks.passed < 16, 'Static checks should have failed');

  console.log('\n✓ POST /api/validator/bulk verification passed 100%!');
  } finally {
    server.close();
  }
}

testBulkEndpoint().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
