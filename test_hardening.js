const fs = require('fs');
const path = require('path');
const assert = require('assert');

// Ensure test environment
process.env.ALLOW_LOCAL_SCRAPING = 'true';
process.env.NODE_ENV = 'test';

const { startServer } = require('./dist/server/index.js');
const { HuntIQConfigManager } = require('./dist/integrations/huntiq/index.js');

async function runHardeningTests() {
  console.log('\n🔒 Starting Production Hardening & Security Audit Test Suite...');

  // Configure test port
  const TEST_PORT = 3009;
  const BASE_URL = `http://localhost:${TEST_PORT}`;
  const server = startServer(TEST_PORT);

  // Give server a moment to start
  await new Promise(r => setTimeout(r, 600));

  try {
    /* ========================================================================= */
    /* 1. Protected HUNTIQ Config Endpoint: Admin Auth Enforcement              */
    /* ========================================================================= */
    console.log('\nTest 1: Testing HUNTIQ Config Admin Auth Protection...');
    
    // Simulate setting an admin key
    process.env.ADMIN_API_KEY = 'test-secret-admin-key-987';

    // Attempting to post without auth header should be rejected with 401
    const unauthorizedRes = await fetch(`${BASE_URL}/api/integrations/huntiq/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiUrl: 'https://huntiq.test.corp',
        apiKey: 'hnt_new_secret_123',
        enabled: true
      })
    });
    assert.strictEqual(unauthorizedRes.status, 401, 'Unauthorized request must return HTTP 401');
    const unauthorizedData = await unauthorizedRes.json();
    assert.strictEqual(unauthorizedData.success, false);
    assert.ok(unauthorizedData.error.includes('Unauthorized'), 'Error message must specify unauthorized');
    console.log('   ✓ Test 1 passed: Unauthenticated POST /api/integrations/huntiq/config strictly rejected with 401.');

    /* ========================================================================= */
    /* 2. Authorized HUNTIQ Config Update                                       */
    /* ========================================================================= */
    console.log('\nTest 2: Testing Authorized HUNTIQ Config Update...');

    const authorizedRes = await fetch(`${BASE_URL}/api/integrations/huntiq/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-secret-admin-key-987'
      },
      body: JSON.stringify({
        apiUrl: 'https://huntiq.test.corp/api',
        apiKey: 'hnt_secure_key_555',
        enabled: true,
        timeoutMs: 25000,
        maxRetries: 4
      })
    });
    assert.strictEqual(authorizedRes.status, 200, 'Authorized request should return 200');
    const authorizedData = await authorizedRes.json();
    assert.strictEqual(authorizedData.success, true);
    assert.strictEqual(authorizedData.hasApiKey, true);
    assert.strictEqual(authorizedData.apiKey, '', 'apiKey should NEVER be returned in response');
    assert.strictEqual(authorizedData.storage, 'runtime_memory', 'Storage should be explicitly declared runtime_memory');
    console.log('   ✓ Test 2 passed: Authorized admin request successfully applied runtime configuration.');

    /* ========================================================================= */
    /* 3. Sanitized GET Config (No Raw or Masked Secrets Returned)             */
    /* ========================================================================= */
    console.log('\nTest 3: Testing Sanitized GET /api/integrations/huntiq/config...');

    const getRes = await fetch(`${BASE_URL}/api/integrations/huntiq/config`);
    const getData = await getRes.json();
    assert.strictEqual(getData.success, true);
    assert.strictEqual(getData.hasApiKey, true);
    assert.strictEqual(getData.apiKey, '', 'apiKey must be empty string; must never return raw or masked key');
    assert.strictEqual(getData.apiUrl, 'https://huntiq.test.corp/api');
    assert.strictEqual(getData.timeoutMs, 25000);
    assert.strictEqual(getData.maxRetries, 4);
    assert.strictEqual(getData.isConfigured, true);
    assert.strictEqual(getData.storage, 'runtime_memory');
    console.log('   ✓ Test 3 passed: GET config strictly returns sanitized status without revealing secrets or partial characters.');

    /* ========================================================================= */
    /* 4. No Runtime .env Mutation Verification                                 */
    /* ========================================================================= */
    console.log('\nTest 4: Verifying HTTP Request Does NOT Write to .env...');

    const envPath = path.resolve(__dirname, '.env');
    let originalEnvContent = '';
    if (fs.existsSync(envPath)) {
      originalEnvContent = fs.readFileSync(envPath, 'utf8');
    }

    // Perform another update
    await fetch(`${BASE_URL}/api/integrations/huntiq/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-secret-admin-key-987'
      },
      body: JSON.stringify({
        apiUrl: 'https://huntiq.test.corp/v2',
        apiKey: 'hnt_new_candidate_key_999',
        enabled: true
      })
    });

    if (fs.existsSync(envPath)) {
      const currentEnvContent = fs.readFileSync(envPath, 'utf8');
      assert.strictEqual(
        currentEnvContent,
        originalEnvContent,
        '.env file must NOT be modified by runtime HTTP configuration updates'
      );
    }
    console.log('   ✓ Test 4 passed: Zero runtime writes to .env; deployment configuration preserved intact.');

    /* ========================================================================= */
    /* 5. Input Validation for HUNTIQ Configuration (400 Bad Request)           */
    /* ========================================================================= */
    console.log('\nTest 5: Testing Input Validation on /api/integrations/huntiq/config...');

    // 5a. Malformed URL
    const badUrlRes = await fetch(`${BASE_URL}/api/integrations/huntiq/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-secret-admin-key-987' },
      body: JSON.stringify({ apiUrl: 'not-a-valid-url' })
    });
    assert.strictEqual(badUrlRes.status, 400, 'Malformed URL must return HTTP 400');
    const badUrlData = await badUrlRes.json();
    assert.ok(badUrlData.error.includes('valid URL'));

    // 5b. Unsafe protocol (javascript:, ftp:, file:)
    const unsafeProtoRes = await fetch(`${BASE_URL}/api/integrations/huntiq/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-secret-admin-key-987' },
      body: JSON.stringify({ apiUrl: 'javascript:alert(1)' })
    });
    assert.strictEqual(unsafeProtoRes.status, 400, 'Unsafe protocol must return HTTP 400');

    // 5c. Out of bounds timeoutMs (< 1000 or > 120000)
    const badTimeoutRes = await fetch(`${BASE_URL}/api/integrations/huntiq/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-secret-admin-key-987' },
      body: JSON.stringify({ timeoutMs: 50 })
    });
    assert.strictEqual(badTimeoutRes.status, 400, 'Timeout below 1000ms must return HTTP 400');

    // 5d. Out of bounds maxRetries (< 0 or > 10)
    const badRetriesRes = await fetch(`${BASE_URL}/api/integrations/huntiq/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-secret-admin-key-987' },
      body: JSON.stringify({ maxRetries: 99 })
    });
    assert.strictEqual(badRetriesRes.status, 400, 'Retries > 10 must return HTTP 400');

    // 5e. Invalid enabled type
    const badEnabledRes = await fetch(`${BASE_URL}/api/integrations/huntiq/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-secret-admin-key-987' },
      body: JSON.stringify({ enabled: 'maybe' })
    });
    assert.strictEqual(badEnabledRes.status, 400, 'Invalid enabled must return HTTP 400');

    console.log('   ✓ Test 5 passed: All configuration input validations correctly rejected with HTTP 400.');

    /* ========================================================================= */
    /* 6. Masked API Key Update Semantics                                       */
    /* ========================================================================= */
    console.log('\nTest 6: Testing Masked API Key Update Semantics...');

    // Current key is 'hnt_new_candidate_key_999'
    // Send empty key or masked key -> existing key should remain intact
    const keepKeyRes = await fetch(`${BASE_URL}/api/integrations/huntiq/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-secret-admin-key-987' },
      body: JSON.stringify({
        apiKey: '••••••••',
        timeoutMs: 35000
      })
    });
    assert.strictEqual(keepKeyRes.status, 200);
    const serverConfig = HuntIQConfigManager.getConfig();
    assert.strictEqual(serverConfig.apiKey, 'hnt_new_candidate_key_999', 'Masked placeholder must not overwrite real key');
    assert.strictEqual(serverConfig.timeoutMs, 35000);
    console.log('   ✓ Test 6 passed: Masked key does not overwrite existing secret token.');

    /* ========================================================================= */
    /* 7. Input Validation on /api/export                                       */
    /* ========================================================================= */
    console.log('\nTest 7: Testing Input Validation on /api/export...');

    // 7a. Invalid format
    const badFormatRes = await fetch(`${BASE_URL}/api/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: [{ email: 'test@example.com' }], format: 'xml' })
    });
    assert.strictEqual(badFormatRes.status, 400, 'Unsupported format must return HTTP 400');

    // 7b. Oversized records array (> 50,000)
    const oversizedRecords = new Array(50001).fill({ email: 'spam@example.com' });
    const oversizedExportRes = await fetch(`${BASE_URL}/api/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: oversizedRecords, format: 'csv' })
    });
    assert.strictEqual(oversizedExportRes.status, 400, 'Records > 50,000 must return HTTP 400');
    console.log('   ✓ Test 7 passed: Export payload bounds and format validation strictly enforced.');

    /* ========================================================================= */
    /* 8. Input Validation and Storage Driver on /api/folders                   */
    /* ========================================================================= */
    console.log('\nTest 8: Testing /api/folders Input Validation and Driver Metadata...');

    // 8a. GET folders returns storage info
    const foldersRes = await fetch(`${BASE_URL}/api/folders`);
    assert.strictEqual(foldersRes.status, 200);
    const foldersData = await foldersRes.json();
    assert.strictEqual(foldersData.success, true);
    assert.ok(foldersData.storage, 'Storage driver type must be declared');

    // 8b. Empty folder name -> 400
    const emptyFolderRes = await fetch(`${BASE_URL}/api/folders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '   ' })
    });
    assert.strictEqual(emptyFolderRes.status, 400);

    // 8c. Oversized folder name (> 100 chars) -> 400
    const longNameFolderRes = await fetch(`${BASE_URL}/api/folders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'a'.repeat(105) })
    });
    assert.strictEqual(longNameFolderRes.status, 400);
    console.log('   ✓ Test 8 passed: Folder validation and storage driver metadata verified.');

    /* ========================================================================= */
    /* 9. HTTP Security Headers Verification                                    */
    /* ========================================================================= */
    console.log('\nTest 9: Testing HTTP Security Headers...');

    const secRes = await fetch(`${BASE_URL}/api/health`);
    assert.strictEqual(secRes.headers.get('x-content-type-options'), 'nosniff');
    assert.strictEqual(secRes.headers.get('x-frame-options'), 'DENY');
    assert.strictEqual(secRes.headers.get('x-xss-protection'), '1; mode=block');
    console.log('   ✓ Test 9 passed: Standard security headers present on responses.');

    /* ========================================================================= */
    /* 10. Crawl Cancellation & Job Lifecycle Verification                      */
    /* ========================================================================= */
    console.log('\nTest 10: Testing Crawl Cancellation Lifecycle...');

    const crawlStartRes = await fetch(`${BASE_URL}/api/scrape/crawl`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: `${BASE_URL}/api/demo`,
        maxDepth: 2,
        maxPages: 5,
        delayMs: 100
      })
    });
    const crawlData = await crawlStartRes.json();
    assert.strictEqual(crawlData.success, true);
    assert.ok(crawlData.jobId);

    // Cancel crawl
    const cancelRes = await fetch(`${BASE_URL}/api/scrape/crawl/cancel/${crawlData.jobId}`, {
      method: 'POST'
    });
    assert.strictEqual(cancelRes.status, 200);
    const cancelData = await cancelRes.json();
    assert.strictEqual(cancelData.success, true);
    console.log('   ✓ Test 10 passed: Crawl cancellation executed cleanly.');

    console.log('\n🎉 All Production Hardening & Security Audit Tests Passed Successfully!\n');
  } finally {
    // Reset test env
    delete process.env.ADMIN_API_KEY;
    server.close();
  }
}

runHardeningTests().catch(err => {
  console.error('\n❌ Hardening test failed:', err);
  process.exit(1);
});
