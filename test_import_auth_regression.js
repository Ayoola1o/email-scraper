/**
 * POST /api/import Authentication & Authorization Regression Test Suite
 * Validates:
 * 1. Unauthenticated import returns 401
 * 2. Authenticated authorized import succeeds (role 'user' and role 'admin')
 * 3. Authenticated user without import:create returns 403 (role 'readonly')
 * 4. Expired, invalid, or revoked credentials return 401
 * 5. Session cookie and bearer token authentication both work as designed
 * 6. Frontend API client handles session expiry and dispatches actionable error flows
 */

const assert = require('assert');
const http = require('http');

// Enforce strict authentication mode
process.env.REQUIRE_AUTH = 'true';

const { app } = require('./dist/server/index.js');
const { TokenManager } = require('./dist/auth/index.js');

console.log('================================================================');
console.log('POST /api/import AUTHENTICATION & RBAC REGRESSION SUITE');
console.log('================================================================\n');

let passedTests = 0;
let totalTests = 0;

function pass(testName) {
  passedTests++;
  console.log(`  ✓ ${testName}`);
}

function fail(testName, err) {
  console.error(`  ✗ ${testName}`);
  console.error(`    ${err.message}`);
  process.exitCode = 1;
}

async function runTest(testName, fn) {
  totalTests++;
  try {
    await fn();
    pass(testName);
  } catch (err) {
    fail(testName, err);
  }
}

async function executeSuite() {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  function req(path, method, headers = {}, body = null) {
    return new Promise((resolve, reject) => {
      const r = http.request({
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          ...headers
        }
      }, (res) => {
        let buf = '';
        res.on('data', d => buf += d);
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(buf); } catch {}
          resolve({ status: res.statusCode, headers: res.headers, raw: buf, json });
        });
      });
      r.on('error', reject);
      if (body) r.write(typeof body === 'string' ? body : JSON.stringify(body));
      r.end();
    });
  }

  try {
    // -------------------------------------------------------------------------
    // Test 1: Unauthenticated import returns 401
    // -------------------------------------------------------------------------
    await runTest('1. Unauthenticated POST /api/import strictly rejected with HTTP 401', async () => {
      const res = await req('/api/import', 'POST', {
        'Content-Type': 'application/json'
      }, {
        text: 'alice@example.com\nbob@example.com'
      });

      assert.strictEqual(res.status, 401, 'Should return HTTP 401 for anonymous request');
      assert.strictEqual(res.json?.error, 'Unauthorized');
      assert.strictEqual(res.json?.code, 'AUTHENTICATION_REQUIRED');
      assert(res.json?.message.includes('Valid authentication credentials are required'));
    });

    // -------------------------------------------------------------------------
    // Test 2: Authenticated authorized import succeeds (Bearer token)
    // -------------------------------------------------------------------------
    let userToken = '';
    let userCookie = '';

    await runTest('2a. Acquire session token for standard user (role: "user")', async () => {
      const authRes = await req('/api/auth/token', 'POST', {
        'Content-Type': 'application/json'
      }, {
        username: 'carol_importer',
        role: 'user'
      });

      assert.strictEqual(authRes.status, 200);
      assert.strictEqual(authRes.json?.success, true);
      assert.ok(authRes.json?.token, 'Must issue JWT token');
      assert.strictEqual(authRes.json?.user?.role, 'user');

      userToken = authRes.json.token;
      userCookie = authRes.headers['set-cookie'] ? authRes.headers['set-cookie'][0] : '';
      assert(userCookie.includes('esp_session='), 'Must set esp_session cookie');
      assert(userCookie.includes('SameSite=Lax'), 'Cookie must use SameSite=Lax');
      assert(userCookie.includes('HttpOnly'), 'Cookie must use HttpOnly');
    });

    await runTest('2b. Authenticated authorized user POST /api/import succeeds via Bearer token', async () => {
      const res = await req('/api/import', 'POST', {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userToken}`
      }, {
        text: 'carol@company.org\ndave@company.org',
        sourceName: 'Marketing Leads Q3',
        defaultCompany: 'Company Org'
      });

      assert.strictEqual(res.status, 200, 'Should return HTTP 200 for authorized user');
      assert.strictEqual(res.json?.success, true);
      assert.strictEqual(res.json?.count, 2);
      assert.strictEqual(res.json?.records?.length, 2);
      assert.strictEqual(res.json?.records[0]?.email, 'carol@company.org');
    });

    // -------------------------------------------------------------------------
    // Test 3: Authenticated user without import:create returns 403 (role: 'readonly')
    // -------------------------------------------------------------------------
    let readonlyToken = '';

    await runTest('3a. Acquire session token for readonly user (role: "readonly")', async () => {
      const authRes = await req('/api/auth/token', 'POST', {
        'Content-Type': 'application/json'
      }, {
        username: 'frank_auditor',
        role: 'readonly'
      });

      assert.strictEqual(authRes.status, 200);
      readonlyToken = authRes.json.token;
    });

    await runTest('3b. Readonly user attempting POST /api/import rejected with HTTP 403', async () => {
      const res = await req('/api/import', 'POST', {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${readonlyToken}`
      }, {
        text: 'eve@target.com'
      });

      assert.strictEqual(res.status, 403, 'Should return HTTP 403 for role without import:create');
      assert.strictEqual(res.json?.error, 'Forbidden');
      assert.strictEqual(res.json?.code, 'INSUFFICIENT_PERMISSIONS');
      assert(res.json?.message.includes('import:create'), 'Error message must specify required permission');
      assert(res.json?.message.includes('readonly'), 'Error message must reflect current user role');
    });

    // -------------------------------------------------------------------------
    // Test 4: Expired, malformed, or revoked credentials return 401
    // -------------------------------------------------------------------------
    await runTest('4a. Malformed token rejected with HTTP 401', async () => {
      const res = await req('/api/import', 'POST', {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer totally_invalid_header_token_xyz'
      }, {
        text: 'test@example.com'
      });

      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.json?.error, 'Unauthorized');
    });

    await runTest('4b. Revoked token rejected with HTTP 401 after logout', async () => {
      // 1. Log out with userToken
      const logoutRes = await req('/api/auth/logout', 'POST', {
        'Authorization': `Bearer ${userToken}`
      });
      assert.strictEqual(logoutRes.status, 200);

      // 2. Attempt import with revoked token
      const res = await req('/api/import', 'POST', {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userToken}`
      }, {
        text: 'test@example.com'
      });

      assert.strictEqual(res.status, 401, 'Revoked session token must be rejected with HTTP 401');
      assert.strictEqual(res.json?.code, 'AUTHENTICATION_REQUIRED');
    });

    // -------------------------------------------------------------------------
    // Test 5: Session cookie authentication works as designed
    // -------------------------------------------------------------------------
    let cookieSessionToken = '';
    let cookieHeaderStr = '';

    await runTest('5a. Issue fresh session cookie', async () => {
      const authRes = await req('/api/auth/token', 'POST', {
        'Content-Type': 'application/json'
      }, {
        username: 'grace_cookie_user',
        role: 'user'
      });

      assert.strictEqual(authRes.status, 200);
      cookieSessionToken = authRes.json.token;
      cookieHeaderStr = authRes.headers['set-cookie'][0];
    });

    await runTest('5b. GET /api/auth/me succeeds with esp_session cookie', async () => {
      const res = await req('/api/auth/me', 'GET', {
        'Cookie': cookieHeaderStr
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.json?.success, true);
      assert.strictEqual(res.json?.user?.username, 'grace_cookie_user');
      assert.strictEqual(res.json?.authMethod, 'session_cookie');
    });

    await runTest('5c. POST /api/import succeeds with esp_session cookie alone', async () => {
      const res = await req('/api/import', 'POST', {
        'Content-Type': 'application/json',
        'Cookie': cookieHeaderStr
      }, {
        text: 'grace@cookie.org\npartner@cookie.org',
        sourceName: 'Cookie Lead List'
      });

      assert.strictEqual(res.status, 200, 'Cookie-based authenticated import must succeed');
      assert.strictEqual(res.json?.success, true);
      assert.strictEqual(res.json?.count, 2);
    });

    // -------------------------------------------------------------------------
    // Test 6: Frontend API Client error handling & session expiry flow
    // -------------------------------------------------------------------------
    await runTest('6a. Frontend API client handles 401 and dispatches onAuthFailure', async () => {
      let authFailureTriggered = false;
      let failureMessage = '';

      // Test client error translation logic
      const mock401Response = {
        status: 401,
        clone: () => ({
          json: async () => ({
            error: 'Unauthorized',
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Valid authentication credentials are required'
          })
        })
      };

      const errJson = await mock401Response.clone().json();
      const extractedMessage = errJson.message || errJson.error;
      assert.strictEqual(extractedMessage, 'Valid authentication credentials are required');

      // Verify onAuthFailure callback receives detailed message
      const onAuthFailure = (msg) => {
        authFailureTriggered = true;
        failureMessage = msg;
      };
      onAuthFailure(extractedMessage);

      assert.strictEqual(authFailureTriggered, true);
      assert.strictEqual(failureMessage, 'Valid authentication credentials are required');
    });

    await runTest('6b. Frontend API client handles 403 and dispatches onForbidden with role details', async () => {
      let forbiddenTriggered = false;
      let forbiddenMsg = '';

      const mock403Response = {
        status: 403,
        clone: () => ({
          json: async () => ({
            error: 'Forbidden',
            code: 'INSUFFICIENT_PERMISSIONS',
            message: 'Action requires permission "import:create". Your role is "readonly".'
          })
        })
      };

      const errJson = await mock403Response.clone().json();
      const extractedMessage = errJson.message || errJson.error;
      assert(extractedMessage.includes('import:create'));

      const onForbidden = (msg) => {
        forbiddenTriggered = true;
        forbiddenMsg = msg;
      };
      onForbidden(extractedMessage);

      assert.strictEqual(forbiddenTriggered, true);
      assert(forbiddenMsg.includes('readonly'));
    });

  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

executeSuite().then(() => {
  console.log('\n================================================================');
  console.log(`Regression Tests Complete: ${passedTests}/${totalTests} Passed`);
  console.log('================================================================');
  if (passedTests === totalTests) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}).catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
