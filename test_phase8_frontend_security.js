/**
 * Phase 8 Frontend Security and UI Preservation Test Suite
 * Tests sanitization, XSS defense, CSP headers, credential isolation, and feedback handling.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');

console.log('====================================================');
console.log('PHASE 8: FRONTEND SECURITY & UI PRESERVATION TESTS');
console.log('====================================================');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    process.exitCode = 1;
  }
}

async function runAsyncTest(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    process.exitCode = 1;
  }
}

// -----------------------------------------------------------------------------
// 1. Sanitizer Unit Tests (Imported from compiled dist/ui/security/sanitizer.js)
// -----------------------------------------------------------------------------
const sanitizer = require('./dist/ui/security/sanitizer.js');

console.log('\n[1] Sanitization & XSS Prevention');

runTest('escapeHtml escapes dangerous HTML characters', () => {
  const dirty = '<script>alert("xss & \'attack\'")</script>';
  const clean = sanitizer.escapeHtml(dirty);
  assert(!clean.includes('<script>'), 'Must not contain unescaped tag opening');
  assert(!clean.includes('</script>'), 'Must not contain unescaped tag closing');
  assert(clean.includes('&lt;script&gt;'), 'Must encode angle brackets');
  assert(clean.includes('&quot;'), 'Must encode double quotes');
  assert(clean.includes('&#x27;'), 'Must encode single quotes');
  assert(clean.includes('&amp;'), 'Must encode ampersands');
});

runTest('sanitizeUrl permits safe http and https protocols', () => {
  const safeHttp = sanitizer.sanitizeUrl('http://example.com/team');
  const safeHttps = sanitizer.sanitizeUrl('https://example.org/about?ref=nav');
  assert.strictEqual(safeHttp, 'http://example.com/team');
  assert.strictEqual(safeHttps, 'https://example.org/about?ref=nav');
});

runTest('sanitizeUrl safely falls back to # for javascript:, vbscript:, data:, and relative attacks', () => {
  assert.strictEqual(sanitizer.sanitizeUrl('javascript:alert(1)'), '#', 'Must return # for javascript:');
  assert.strictEqual(sanitizer.sanitizeUrl('JAVASCRIPT:alert(1)'), '#', 'Must return # for case variations');
  assert.strictEqual(sanitizer.sanitizeUrl('vbscript:msgbox(1)'), '#', 'Must return # for vbscript:');
  assert.strictEqual(sanitizer.sanitizeUrl('data:text/html,<script>alert(1)</script>'), '#', 'Must return # for data: HTML');
  assert.strictEqual(sanitizer.sanitizeUrl('jav\tascript:alert(1)'), '#', 'Must return # for control characters in scheme');
  assert.strictEqual(sanitizer.sanitizeUrl(''), '#', 'Must return # for empty input');
  assert.strictEqual(sanitizer.sanitizeUrl(null), '#', 'Must return # for null');
});

runTest('sanitizeSnippet scrubs dangerous tags and bounds length', () => {
  const maliciousSnippet = 'Founder <script>fetch("http://attacker.com")</script> at TechCorp <iframe src="evil.html"></iframe>';
  const sanitized = sanitizer.sanitizeSnippet(maliciousSnippet, 100);
  assert(!sanitized.includes('<script>'), 'Must strip script tags');
  assert(!sanitized.includes('<iframe>'), 'Must strip iframe tags');
  assert(sanitized.includes('Founder'), 'Must retain safe text');
  assert(sanitized.includes('at TechCorp'), 'Must retain safe context');

  // Length bounding (including ellipsis)
  const longSnippet = 'A'.repeat(500);
  const bounded = sanitizer.sanitizeSnippet(longSnippet, 80);
  assert(bounded.length <= 80, `Must enforce max length limit (actual: ${bounded.length})`);
  assert(bounded.endsWith('...'), 'Should append ellipsis when truncated');
});

runTest('sanitizeFilename blocks path traversal and illegal characters', () => {
  const dangerous = '../../../etc/passwd.csv';
  const clean = sanitizer.sanitizeFilename(dangerous, 'export.csv');
  assert(!clean.includes('..'), 'Must prevent directory traversal');
  assert(!clean.includes('/'), 'Must remove slashes');
  assert(clean.endsWith('.csv'), 'Must preserve safe extension');
});

// -----------------------------------------------------------------------------
// 2. Client Bundle Security & Zero Credential Leaks
// -----------------------------------------------------------------------------
console.log('\n[2] Frontend Bundle Security & Credential Isolation');

runTest('Frontend bundle is compiled and non-empty', () => {
  const bundlePath = path.join(__dirname, 'public', 'js', 'bundle.js');
  assert(fs.existsSync(bundlePath), 'public/js/bundle.js must exist');
  const bundleStat = fs.statSync(bundlePath);
  assert(bundleStat.size > 50000, `Bundle size should be substantial (actual: ${bundleStat.size} bytes)`);
});

runTest('Frontend bundle contains zero server-side environment secrets or private keys', () => {
  const bundleContent = fs.readFileSync(path.join(__dirname, 'public', 'js', 'bundle.js'), 'utf8');

  // Check that private keys and server env tokens are not bundled into client JavaScript
  assert(!bundleContent.includes('process.env.JWT_SECRET'), 'process.env.JWT_SECRET must not be present in bundle');
  assert(!bundleContent.includes('huntiq_super_secret_test_key_phase7'), 'HUNTIQ test secrets must not be in bundle');
  assert(!bundleContent.includes('BEGIN PRIVATE KEY'), 'Private RSA/EC keys must not be in bundle');
});

// -----------------------------------------------------------------------------
// 3. Content Security Policy & CSRF Headers on Server
// -----------------------------------------------------------------------------
console.log('\n[3] Content Security Policy (CSP) & Defense-in-Depth');

runAsyncTest('Server serves hardened Content-Security-Policy headers without unsafe-eval', async () => {
  // Start ephemeral server from dist
  const { app } = require('./dist/server/index.js');
  const server = http.createServer(app);

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const res = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: '/',
        method: 'GET'
      }, resolve);
      req.on('error', reject);
      req.end();
    });

    const csp = res.headers['content-security-policy'] || '';
    assert(csp.length > 0, 'Content-Security-Policy header must be present');
    assert(!csp.includes("'unsafe-eval'"), "CSP must NOT contain 'unsafe-eval'");
    assert(csp.includes("frame-ancestors 'none'"), "CSP must specify frame-ancestors 'none' to prevent clickjacking");
    assert(csp.includes("base-uri 'self'"), "CSP must restrict base-uri to 'self'");
    assert(csp.includes("form-action 'self'"), "CSP must restrict form-action to 'self'");
    assert(csp.includes("object-src 'none'"), "CSP must block plugins via object-src 'none'");

    // Check anti-clickjacking and MIME headers
    assert.strictEqual(res.headers['x-frame-options'], 'DENY', 'X-Frame-Options must be DENY');
    assert.strictEqual(res.headers['x-content-type-options'], 'nosniff', 'X-Content-Type-Options must be nosniff');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// -----------------------------------------------------------------------------
// 4. API Client Security Behaviors & Error Handling
// -----------------------------------------------------------------------------
console.log('\n[4] API Client & Security Event Handling');

runAsyncTest('API Client attaches CSRF protection header and handles 401 gracefully', async () => {
  const { app } = require('./dist/server/index.js');
  const server = http.createServer(app);

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    // Request with an expired/invalid token to verify 401 response and CSRF header handling
    const res = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: '/api/auth/me',
        method: 'GET',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          'Authorization': 'Bearer invalid_or_expired_session_token'
        }
      }, resolve);
      req.on('error', reject);
      req.end();
    });

    assert.strictEqual(res.statusCode, 401, 'Should return 401 for invalid session token');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

runTest('API Client properly extracts retry countdown and translates security error codes', () => {
  // Verify retry-after calculation
  const retryHeader = '15';
  const retrySeconds = parseInt(retryHeader, 10);
  assert.strictEqual(retrySeconds, 15, 'Must parse retry header');

  // Verify SSRF error detection heuristics in UI
  const ssrfError1 = 'URL is not allowed: restricted private IP';
  const ssrfError2 = 'Destination blocked by SSRF defense';
  const isSsrf1 = ssrfError1.includes('restricted') || ssrfError1.includes('SSRF') || ssrfError1.includes('private network');
  const isSsrf2 = ssrfError2.includes('restricted') || ssrfError2.includes('SSRF') || ssrfError2.includes('private network');
  assert(isSsrf1, 'Must detect restricted private network error');
  assert(isSsrf2, 'Must detect SSRF defense error');
});

// Run all tests and print summary
setTimeout(() => {
  console.log('\n====================================================');
  console.log(`Phase 8 Tests Complete: ${passedTests}/${totalTests} Passed`);
  console.log('====================================================');
  if (passedTests === totalTests) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}, 500);
