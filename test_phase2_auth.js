const assert = require('assert');
const { startServer } = require('./dist/server/index.js');
const {
  TokenManager,
  ApiKeyManager,
  hashApiKey,
  ConcurrencyTracker,
  RateLimiter
} = require('./dist/auth/index.js');

async function runPhase2AuthTests() {
  console.log('\n🔐 Starting Phase Two: API Authentication & Authorization Test Suite...\n');

  const TEST_PORT = 3020;
  const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
  const server = startServer(TEST_PORT);

  // Give server time to bind
  await new Promise(r => setTimeout(r, 600));

  try {
    /* ========================================================================= */
    /* 1. Token-Based Authentication & Session Management                       */
    /* ========================================================================= */
    console.log('1. Testing Session Token Generation, Validation & Expiration...');

    // 1a. Generate token via POST /api/auth/token
    const authRes = await fetch(`${BASE_URL}/api/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'alice', role: 'user' })
    });
    assert.strictEqual(authRes.status, 200);
    const authData = await authRes.json();
    assert.strictEqual(authData.success, true);
    assert.ok(authData.token, 'Must return signed token');
    assert.strictEqual(authData.user.username, 'alice');
    assert.strictEqual(authData.user.role, 'user');
    const aliceToken = authData.token;
    const aliceId = authData.user.id;

    // Check Set-Cookie was emitted
    const setCookieHeader = authRes.headers.get('set-cookie');
    assert.ok(setCookieHeader && setCookieHeader.includes('esp_session='), 'Set-Cookie header must be emitted');
    console.log('   ✓ Token generation and session cookie verified.');

    // 1b. Inspect authenticated user context via GET /api/auth/me
    const meRes = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: { 'Authorization': `Bearer ${aliceToken}` }
    });
    assert.strictEqual(meRes.status, 200);
    const meData = await meRes.json();
    assert.strictEqual(meData.user.username, 'alice');
    assert.strictEqual(meData.authMethod, 'bearer_token');
    console.log('   ✓ GET /api/auth/me returned correct authenticated context.');

    // 1c. Revoke token via POST /api/auth/logout
    const logoutRes = await fetch(`${BASE_URL}/api/auth/logout`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${aliceToken}` }
    });
    assert.strictEqual(logoutRes.status, 200);
    const logoutData = await logoutRes.json();
    assert.strictEqual(logoutData.success, true);

    // Subsequent call with revoked token must fail with 401
    const postLogoutRes = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: { 'Authorization': `Bearer ${aliceToken}` }
    });
    assert.strictEqual(postLogoutRes.status, 401, 'Revoked token must be rejected with HTTP 401');
    console.log('   ✓ Token revocation / logout successfully verified.');

    /* ========================================================================= */
    /* 2. Programmatic API Key Management & Hash Storage                        */
    /* ========================================================================= */
    console.log('\n2. Testing Programmatic API Key Creation & Cryptographic Storage...');

    // 2a. Issue new admin token to manage keys
    const adminTokenRes = await fetch(`${BASE_URL}/api/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'superadmin', role: 'admin' })
    });
    const { token: adminToken } = await adminTokenRes.json();

    // 2b. Admin creates a service API key
    const createKeyRes = await fetch(`${BASE_URL}/api/auth/keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        name: 'HUNTIQ Integration Service Key',
        role: 'service',
        expiresInDays: 30
      })
    });
    assert.strictEqual(createKeyRes.status, 201);
    const createKeyData = await createKeyRes.json();
    assert.strictEqual(createKeyData.success, true);
    assert.ok(createKeyData.rawKey.startsWith('esp_live_'), 'Raw key must use prefix esp_live_');
    assert.strictEqual(createKeyData.key.keyHash, undefined, 'Raw keyHash must NEVER be exposed in API responses');
    const serviceRawKey = createKeyData.rawKey;
    const serviceKeyId = createKeyData.key.id;

    // 2c. Authenticate with X-API-Key header
    const keyAuthRes = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: { 'X-API-Key': serviceRawKey }
    });
    assert.strictEqual(keyAuthRes.status, 200);
    const keyAuthData = await keyAuthRes.json();
    assert.strictEqual(keyAuthData.user.role, 'service');
    assert.strictEqual(keyAuthData.authMethod, 'api_key');
    console.log('   ✓ Programmatic API key generated and authenticated via X-API-Key.');

    // 2d. Revoke API key and verify immediate rejection
    const revokeRes = await fetch(`${BASE_URL}/api/auth/keys/${serviceKeyId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.strictEqual(revokeRes.status, 200);

    const postRevokeRes = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: { 'X-API-Key': serviceRawKey }
    });
    assert.strictEqual(postRevokeRes.status, 401, 'Revoked API key must be rejected with 401');
    console.log('   ✓ API key revocation strictly enforced.');

    /* ========================================================================= */
    /* 3. Role-Based Access Control (RBAC)                                      */
    /* ========================================================================= */
    console.log('\n3. Testing Role-Based Access Control (admin, user, readonly, service)...');

    // 3a. Readonly user attempting to start a crawl job -> 403 Forbidden
    const readonlyTokenRes = await fetch(`${BASE_URL}/api/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'auditor', role: 'readonly' })
    });
    const { token: readonlyToken } = await readonlyTokenRes.json();

    const readonlyCrawlRes = await fetch(`${BASE_URL}/api/scrape/crawl`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${readonlyToken}`
      },
      body: JSON.stringify({ url: 'http://127.0.0.1:3020/api/demo' })
    });
    assert.strictEqual(readonlyCrawlRes.status, 403, 'Readonly user must be rejected from crawl:create with 403');
    const readonlyCrawlData = await readonlyCrawlRes.json();
    assert.strictEqual(readonlyCrawlData.code, 'INSUFFICIENT_PERMISSIONS');
    console.log('   ✓ Readonly user forbidden from crawl creation (HTTP 403).');

    // 3b. Readonly user attempting to scrape a page -> 403 Forbidden
    const readonlyScrapeRes = await fetch(`${BASE_URL}/api/scrape/page`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${readonlyToken}`
      },
      body: JSON.stringify({ url: 'http://127.0.0.1:3020/api/demo' })
    });
    assert.strictEqual(readonlyScrapeRes.status, 403, 'Readonly user must be rejected from scrape:create with 403');

    // 3c. Readonly user CAN read export -> 200 OK
    const readonlyExportRes = await fetch(`${BASE_URL}/api/export`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${readonlyToken}`
      },
      body: JSON.stringify({ records: [{ email: 'auditor@example.com' }], format: 'csv' })
    });
    assert.strictEqual(readonlyExportRes.status, 200, 'Readonly user permitted to export:read');
    console.log('   ✓ Readonly user permitted for authorized read/export operations.');

    // 3d. Standard user attempting to modify HUNTIQ config -> 401/403 Forbidden
    const userTokenRes = await fetch(`${BASE_URL}/api/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'bob', role: 'user' })
    });
    const { token: userBobToken } = await userTokenRes.json();

    const userHuntiqRes = await fetch(`${BASE_URL}/api/integrations/huntiq/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userBobToken}`
      },
      body: JSON.stringify({ enabled: true })
    });
    assert.strictEqual(userHuntiqRes.status, 401, 'Standard user cannot configure HUNTIQ');
    console.log('   ✓ Standard user forbidden from administrative HUNTIQ configuration.');

    /* ========================================================================= */
    /* 4. Multi-Tenant IDOR & Resource Ownership Enforcement                    */
    /* ========================================================================= */
    console.log('\n4. Testing Multi-Tenant Resource Ownership & IDOR Protection...');

    // 4a. User Bob starts a crawl job
    const bobCrawlRes = await fetch(`${BASE_URL}/api/scrape/crawl`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userBobToken}`
      },
      body: JSON.stringify({
        url: `${BASE_URL}/api/demo`,
        maxDepth: 1,
        maxPages: 3,
        delayMs: 100
      })
    });
    assert.strictEqual(bobCrawlRes.status, 200);
    const bobCrawlData = await bobCrawlRes.json();
    const bobsJobId = bobCrawlData.jobId;

    // 4b. User Charlie tries to cancel Bob's crawl job (IDOR attack)
    const charlieTokenRes = await fetch(`${BASE_URL}/api/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'charlie', role: 'user' })
    });
    const { token: charlieToken } = await charlieTokenRes.json();

    const idorCancelRes = await fetch(`${BASE_URL}/api/scrape/crawl/cancel/${bobsJobId}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${charlieToken}` }
    });
    assert.strictEqual(idorCancelRes.status, 403, 'User Charlie must be blocked from canceling Bob\'s job');
    const idorCancelData = await idorCancelRes.json();
    assert.strictEqual(idorCancelData.code, 'IDOR_ACCESS_DENIED');
    console.log('   ✓ IDOR cancel attempt by different user strictly blocked with HTTP 403.');

    // 4c. User Charlie tries to inspect/stream Bob's crawl job (IDOR attack)
    const idorStreamRes = await fetch(`${BASE_URL}/api/scrape/crawl/stream/${bobsJobId}`, {
      headers: { 'Authorization': `Bearer ${charlieToken}` }
    });
    assert.strictEqual(idorStreamRes.status, 403, 'User Charlie must be blocked from streaming Bob\'s job');
    const idorStreamData = await idorStreamRes.json();
    assert.strictEqual(idorStreamData.code, 'IDOR_ACCESS_DENIED');
    console.log('   ✓ IDOR stream inspection attempt by different user strictly blocked with HTTP 403.');

    // 4d. Bob CAN cancel his own crawl job
    const bobCancelRes = await fetch(`${BASE_URL}/api/scrape/crawl/cancel/${bobsJobId}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${userBobToken}` }
    });
    assert.strictEqual(bobCancelRes.status, 200, 'Owner Bob can cancel his own job');
    console.log('   ✓ Resource owner successfully allowed to manage own crawl job.');

    /* ========================================================================= */
    /* 5. Concurrency Quotas & Rate Limiting Enforcement                         */
    /* ========================================================================= */
    console.log('\n5. Testing Concurrency Limits & HTTP 429 Retry-After Headers...');

    // 5a. Exceed user concurrent crawl quota (max 3 concurrent)
    const userId = 'usr_quota_test';
    const s1 = ConcurrencyTracker.acquireCrawlSlot(userId, false);
    const s2 = ConcurrencyTracker.acquireCrawlSlot(userId, false);
    const s3 = ConcurrencyTracker.acquireCrawlSlot(userId, false);
    assert.strictEqual(s1.success, true);
    assert.strictEqual(s2.success, true);
    assert.strictEqual(s3.success, true);

    // 4th attempt should be rejected
    const s4 = ConcurrencyTracker.acquireCrawlSlot(userId, false);
    assert.strictEqual(s4.success, false, 'Exceeding MAX_USER_CONCURRENT_CRAWLS must be rejected');
    assert.ok(s4.error.includes('Concurrent crawl limit reached'));
    console.log('   ✓ Concurrency quota correctly capped per user.');

    // Release slots
    ConcurrencyTracker.releaseCrawlSlot(userId, false);
    ConcurrencyTracker.releaseCrawlSlot(userId, false);
    ConcurrencyTracker.releaseCrawlSlot(userId, false);

    // 5b. Verify standard HTTP 429 response structure
    const rateCheck = await RateLimiter.check('test:key:exhausted', 1, 60000);
    const rateExceeded = await RateLimiter.check('test:key:exhausted', 1, 60000);
    assert.strictEqual(rateCheck.allowed, true);
    assert.strictEqual(rateExceeded.allowed, false);
    assert.strictEqual(rateExceeded.remaining, 0);
    assert.ok(rateExceeded.retryAfterSeconds > 0);
    console.log('   ✓ RateLimiter accurately calculates sliding window and Retry-After metadata.');

    console.log('\n🎉 ALL PHASE TWO AUTHENTICATION & AUTHORIZATION TESTS PASSED 100%!\n');
  } finally {
    server.close();
  }
}

runPhase2AuthTests().catch(err => {
  console.error('\n❌ Phase 2 Auth test failed:', err);
  process.exit(1);
});
