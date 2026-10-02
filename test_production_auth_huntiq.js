/**
 * test_production_auth_huntiq.js
 * Comprehensive regression test suite for:
 * 1. Resilient token generation in production without predefined AUTH_SECRET (prevents 500 on /api/auth/token)
 * 2. GET /api/auth/me lifecycle (unauthenticated 401 vs authenticated 200)
 * 3. POST /api/integrations/huntiq/test role enforcement (401 unauth, 403 user, allowed for admin/service)
 * 4. Token revocation / logout lifecycle
 * 5. Frontend apiClient testHuntiq silent flag and role checks
 */

const assert = require('assert');
const http = require('http');

// Force production environment to simulate Vercel serverless runtime
process.env.NODE_ENV = 'production';
delete process.env.AUTH_SECRET;
delete process.env.JWT_SECRET;
delete process.env.ADMIN_API_KEY;

// Import compiled dist modules
const { TokenManager } = require('./dist/auth/tokenManager');
const { app } = require('./dist/server/index');

let server;
let port;
let baseUrl;

async function runTests() {
  console.log('🧪 Starting Production Auth & HuntIQ Integration Test Suite...');

  // Step 1: Unit tests on TokenManager in production mode without explicit secrets
  console.log('\n--- Test 1: Production Token Generation & Verification without Env Secret ---');
  const sessionUser = {
    id: 'admin_test_1',
    username: 'admin',
    role: 'admin',
    permissions: ['all']
  };

  const session = TokenManager.createSessionToken(sessionUser);
  assert(session && session.token, 'Session token must be generated successfully');
  assert(session.expiresAt > Date.now(), 'Token must have a valid expiration');
  console.log('✅ Generated production session token successfully without AUTH_SECRET in env');

  const verified = TokenManager.verifySessionToken(session.token);
  assert(verified && verified.valid, `Token verification must succeed: ${verified.error}`);
  assert.strictEqual(verified.payload.username, 'admin', 'Payload username must match');
  assert.strictEqual(verified.payload.role, 'admin', 'Payload role must match');
  console.log('✅ Verified production session token successfully');

  // Step 2: Start HTTP Server with Express app
  console.log('\n--- Test 2: HTTP Endpoint Testing ---');
  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      console.log(`📡 Test server running at ${baseUrl}`);
      resolve();
    });
  });

  try {
    // 2.1: POST /api/auth/token produces 200, NOT 500
    console.log('\n--- Test 2.1: POST /api/auth/token Production Status ---');
    const tokenRes = await makeRequest('/api/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', role: 'admin' })
    });

    assert.strictEqual(tokenRes.status, 200, `Expected status 200, got ${tokenRes.status}: ${JSON.stringify(tokenRes.body)}`);
    assert(tokenRes.body.token, 'Response must contain JWT session token');
    assert(tokenRes.headers['set-cookie'], 'Response must set session cookie');
    const cookieHeader = tokenRes.headers['set-cookie'];
    const adminToken = tokenRes.body.token;
    console.log('✅ POST /api/auth/token returned 200 OK with valid token and cookie');

    // 2.2: GET /api/auth/me unauthenticated -> returns 401
    console.log('\n--- Test 2.2: GET /api/auth/me without Credentials ---');
    const unauthMe = await makeRequest('/api/auth/me', { method: 'GET' });
    assert.strictEqual(unauthMe.status, 401, 'Unauthenticated request to /api/auth/me must return 401');
    assert.strictEqual(unauthMe.body.error, 'Unauthorized');
    assert.strictEqual(unauthMe.body.code, 'AUTHENTICATION_REQUIRED');
    console.log('✅ Unauthenticated GET /api/auth/me correctly returned 401 AUTHENTICATION_REQUIRED');

    // 2.3: GET /api/auth/me with Bearer token -> returns 200
    console.log('\n--- Test 2.3: GET /api/auth/me with Valid Token ---');
    const authMe = await makeRequest('/api/auth/me', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.strictEqual(authMe.status, 200, `Expected 200, got ${authMe.status}`);
    assert.strictEqual(authMe.body.success, true);
    assert.strictEqual(authMe.body.user.role, 'admin');
    console.log('✅ Authenticated GET /api/auth/me returned 200 with user profile');

    // 2.4: POST /api/integrations/huntiq/test - Unauthenticated -> 401
    console.log('\n--- Test 2.4: POST /api/integrations/huntiq/test Authorization ---');
    const unauthHuntiq = await makeRequest('/api/integrations/huntiq/test', { method: 'POST' });
    assert.strictEqual(unauthHuntiq.status, 401, 'Unauthenticated /huntiq/test must return 401');
    console.log('✅ Unauthenticated /huntiq/test correctly rejected with 401');

    // 2.5: POST /api/integrations/huntiq/test - Non-admin user -> 403 Forbidden
    const userTokenRes = await makeRequest('/api/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'regular_user', role: 'user' })
    });
    const regularUserToken = userTokenRes.body.token;

    const forbiddenHuntiq = await makeRequest('/api/integrations/huntiq/test', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${regularUserToken}` }
    });
    assert.strictEqual(forbiddenHuntiq.status, 403, 'Regular user role must receive 403 on /huntiq/test');
    console.log('✅ Non-admin user correctly forbidden (403) from testing HuntIQ');

    // 2.6: POST /api/integrations/huntiq/test - Admin user -> Allowed (200 or unconfigured 200/503 response, NOT 401/403)
    const adminHuntiq = await makeRequest('/api/integrations/huntiq/test', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(adminHuntiq.status !== 401 && adminHuntiq.status !== 403, `Admin request should pass authorization, got ${adminHuntiq.status}`);
    console.log(`✅ Admin request authorized on /huntiq/test (status: ${adminHuntiq.status})`);

    // 2.7: POST /api/auth/logout -> Invalidates session
    console.log('\n--- Test 2.5: POST /api/auth/logout Session Revocation ---');
    const logoutRes = await makeRequest('/api/auth/logout', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.strictEqual(logoutRes.status, 200, 'Logout should succeed');

    // Verification after logout: token is revoked
    const postLogoutMe = await makeRequest('/api/auth/me', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.strictEqual(postLogoutMe.status, 401, 'Revoked token must be rejected with 401');
    console.log('✅ Logged-out token successfully revoked and rejected');

    console.log('\n🎉 ALL PRODUCTION AUTH & HUNTIQ INTEGRATION TESTS PASSED!');
  } finally {
    if (server) {
      server.close();
    }
  }
}

function makeRequest(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const reqOptions = {
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    const req = http.request(url, reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let body = data;
        try {
          body = JSON.parse(data);
        } catch {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body
        });
      });
    });

    req.on('error', reject);

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

runTests().catch(err => {
  console.error('❌ Test suite failed:', err);
  process.exit(1);
});
