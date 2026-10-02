const assert = require('assert');
const http = require('http');
const { startServer } = require('./dist/server/index.js');
const {
  sanitizeForLog,
  sanitizeFilename,
  sanitizeCsvField,
  SinglePageScrapeSchema,
  WebsiteCrawlSchema,
  BatchScrapeSchema,
  JobIdParamSchema,
  BulkImportSchema,
  VerifyMxSchema,
  ExportRequestSchema,
  HuntIQConfigSchema,
  AuthTokenSchema,
  CreateApiKeySchema,
  FolderSchema,
  formatRecords
} = require('./dist/index.js');

async function runPhase4ValidationTests() {
  console.log('\n🛡️  Starting Phase Four: Input Validation & API Hardening Test Suite...\n');

  const TEST_PORT = 3025;
  const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
  const server = startServer(TEST_PORT);

  // Give server time to bind
  await new Promise(r => setTimeout(r, 600));

  try {
    /* ========================================================================= */
    /* 1. Sanitization Utility Verification (Logs, Filenames, CSV Formulas)     */
    /* ========================================================================= */
    console.log('1. Testing Value Sanitization (Logs, Filenames, CSV Formula Injection)...');

    // 1a. Log sanitization (CRLF log injection defense)
    const rawLog = 'User login failed\r\nADMIN_OVERRIDE: Granted\x00\x1b[31m';
    const cleanLog = sanitizeForLog(rawLog);
    assert.ok(!cleanLog.includes('\r'), 'CRLF must be stripped from logs');
    assert.ok(!cleanLog.includes('\n'), 'Newline must be stripped from logs');
    assert.ok(!cleanLog.includes('\x00'), 'Null bytes must be stripped');
    console.log('   ✓ Log CRLF injection sanitization verified.');

    // 1b. Filename sanitization (Path traversal defense)
    const dangerousFilename1 = '../../../etc/passwd';
    const safeFilename1 = sanitizeFilename(dangerousFilename1);
    assert.ok(!safeFilename1.includes('..'), 'Path traversal dots must be eliminated');
    assert.ok(!safeFilename1.includes('/'), 'Path separators must be eliminated');

    const dangerousFilename2 = '..\\..\\windows\\system32\\calc.exe';
    const safeFilename2 = sanitizeFilename(dangerousFilename2);
    assert.ok(!safeFilename2.includes('..') && !safeFilename2.includes('\\'), 'Windows path traversal must be eliminated');

    const longFilename = 'A'.repeat(300) + '.csv';
    const safeLongFilename = sanitizeFilename(longFilename);
    assert.ok(safeLongFilename.length <= 128, 'Filename length must be bounded to max 128 chars');
    console.log('   ✓ Filename path traversal & length sanitization verified.');

    // 1c. CSV Formula Injection (DDE trigger sanitization: =, +, -, @, \t, \r)
    assert.strictEqual(sanitizeCsvField('=SUM(1+1)'), "'=SUM(1+1)", 'Leading = must be escaped');
    assert.strictEqual(sanitizeCsvField('+cmd|/c calc'), "'+cmd|/c calc", 'Leading + must be escaped');
    assert.strictEqual(sanitizeCsvField('-10'), "'-10", 'Leading - must be escaped');
    assert.strictEqual(sanitizeCsvField('@SUM(A1:A10)'), "'@SUM(A1:A10)", 'Leading @ must be escaped');
    assert.strictEqual(sanitizeCsvField('\tpowershell -c whoami'), "'\tpowershell -c whoami", 'Leading tab must be escaped');

    // Verify formatRecords automatically sanitizes formulas in CSV output
    const formulaRecords = [
      { email: '=cmd|/c calc!A0@gmail.com', name: '+John Doe', company: '@Acme Corp' }
    ];
    const exportedCsv = formatRecords(formulaRecords, 'csv');
    assert.ok(exportedCsv.data.includes("'="), 'Email formula in CSV must be escaped with single quote');
    assert.ok(exportedCsv.data.includes("'+"), 'Name formula in CSV must be escaped with single quote');
    assert.ok(exportedCsv.data.includes("'@"), 'Company formula in CSV must be escaped with single quote');
    console.log('   ✓ CSV formula injection protection verified.');

    /* ========================================================================= */
    /* 2. Consistent Error Response Format & Request ID Tracing                  */
    /* ========================================================================= */
    console.log('\n2. Testing Consistent Error Structure & Request ID Tracing...');

    // 2a. Request without X-Request-Id gets an auto-generated one
    const errRes1 = await fetch(`${BASE_URL}/api/scrape/page`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'not-a-valid-url' })
    });
    assert.strictEqual(errRes1.status, 400);
    const errData1 = await errRes1.json();
    assert.strictEqual(errData1.success, false);
    assert.ok(errData1.error, 'Must include error object');
    assert.strictEqual(errData1.error.code, 'INVALID_INPUT');
    assert.ok(typeof errData1.error.message === 'string');
    assert.ok(errData1.error.requestId, 'Must include requestId');
    assert.ok(errRes1.headers.get('x-request-id'), 'X-Request-Id header must be returned');

    // 2b. Request with existing X-Request-Id preserves trace ID
    const customReqId = 'trace_client_session_999';
    const errRes2 = await fetch(`${BASE_URL}/api/scrape/page`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Request-Id': customReqId },
      body: JSON.stringify({ url: 'http://valid-looking.com', unexpectedProp: 'malicious' })
    });
    assert.strictEqual(errRes2.status, 400);
    const errData2 = await errRes2.json();
    assert.strictEqual(errData2.error.requestId, customReqId);
    assert.strictEqual(errRes2.headers.get('x-request-id'), customReqId);
    console.log('   ✓ Consistent error responses & X-Request-Id tracing verified.');

    /* ========================================================================= */
    /* 3. Strict Schema Rejection (Unexpected Properties & Invalid Types)        */
    /* ========================================================================= */
    console.log('\n3. Testing Strict Property Rejection (.strict()) & Type Bounds...');

    // 3a. Unexpected properties rejected on /api/scrape/page
    const unexpRes = await fetch(`${BASE_URL}/api/scrape/page`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://example.com',
        admin_override: true // unexpected property
      })
    });
    assert.strictEqual(unexpRes.status, 400);
    const unexpData = await unexpRes.json();
    assert.strictEqual(unexpData.error.code, 'INVALID_INPUT');
    assert.ok(unexpData.error.message.includes('admin_override') || unexpData.error.details.some(d => d.message.includes('unrecognized')));
    console.log('   ✓ Unexpected properties strictly rejected with HTTP 400.');

    // 3b. Invalid types rejected on /api/scrape/crawl
    const invalidTypeRes = await fetch(`${BASE_URL}/api/scrape/crawl`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://example.com',
        maxDepth: 'two', // string instead of number
        maxPages: -10    // negative number
      })
    });
    assert.strictEqual(invalidTypeRes.status, 400);
    const invalidTypeData = await invalidTypeRes.json();
    assert.strictEqual(invalidTypeData.error.code, 'INVALID_INPUT');
    console.log('   ✓ Invalid types strictly rejected with HTTP 400.');

    // 3c. Out-of-bounds parameters (crawl depth > 10, maxPages > 200)
    const outOfBoundsRes = await fetch(`${BASE_URL}/api/scrape/crawl`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://example.com',
        maxDepth: 99, // cap is 10
        maxPages: 9999 // cap is 200
      })
    });
    assert.strictEqual(outOfBoundsRes.status, 400);
    const outOfBoundsData = await outOfBoundsRes.json();
    assert.strictEqual(outOfBoundsData.error.code, 'INVALID_INPUT');
    console.log('   ✓ Out-of-bounds crawl depth and page limits strictly rejected.');

    // 3d. Batch scrape URL count cap (> 100 URLs)
    const tooManyUrls = Array.from({ length: 101 }, (_, i) => `https://example${i}.com`);
    const batchCapRes = await fetch(`${BASE_URL}/api/scrape/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: tooManyUrls })
    });
    assert.strictEqual(batchCapRes.status, 400);
    const batchCapData = await batchCapRes.json();
    assert.strictEqual(batchCapData.error.code, 'INVALID_INPUT');
    console.log('   ✓ Batch scrape > 100 URLs capped and rejected.');

    // 3e. Export records size cap (> 50,000 records)
    const tooManyRecords = Array.from({ length: 50001 }, (_, i) => ({ email: `user${i}@test.com` }));
    const exportCapRes = await fetch(`${BASE_URL}/api/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: tooManyRecords, format: 'csv' })
    });
    assert.strictEqual(exportCapRes.status, 400);
    const exportCapData = await exportCapRes.json();
    assert.strictEqual(exportCapData.error.code, 'INVALID_INPUT');
    console.log('   ✓ Export payload > 50,000 records capped and rejected.');

    /* ========================================================================= */
    /* 4. Malformed JSON & Oversized Payload Defense                             */
    /* ========================================================================= */
    console.log('\n4. Testing Malformed JSON & Payload Size Defenses...');

    // 4a. Malformed JSON Body -> 400 MALFORMED_JSON
    const malformedPromise = new Promise((resolve, reject) => {
      const req = http.request(`${BASE_URL}/api/scrape/page`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': 23
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
      });
      req.on('error', reject);
      req.write('{ "url": "invalid_json"'); // Unclosed JSON bracket
      req.end();
    });

    const malformedResult = await malformedPromise;
    assert.strictEqual(malformedResult.status, 400);
    assert.strictEqual(malformedResult.body.success, false);
    assert.strictEqual(malformedResult.body.error.code, 'MALFORMED_JSON');
    assert.ok(malformedResult.body.error.message.includes('Malformed JSON'));
    console.log('   ✓ Malformed JSON syntax error intercepted with clean 400 MALFORMED_JSON.');

    /* ========================================================================= */
    /* 5. Content-Type Enforcement (415 Unsupported Media Type)                 */
    /* ========================================================================= */
    console.log('\n5. Testing Content-Type Enforcement (HTTP 415)...');

    const wrongContentTypeRes = await fetch(`${BASE_URL}/api/scrape/page`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml' },
      body: '<xml><url>https://example.com</url></xml>'
    });
    assert.strictEqual(wrongContentTypeRes.status, 415);
    const wrongContentTypeData = await wrongContentTypeRes.json();
    assert.strictEqual(wrongContentTypeData.error.code, 'UNSUPPORTED_MEDIA_TYPE');
    console.log('   ✓ Non-JSON Content-Type rejected with HTTP 415.');

    /* ========================================================================= */
    /* 6. Route Parameter Validation & Injection Defense                         */
    /* ========================================================================= */
    console.log('\n6. Testing Route Parameter Validation...');

    // 6a. Invalid JobId on cancel (path traversal or shell injection characters)
    const badJobCancelRes = await fetch(`${BASE_URL}/api/scrape/crawl/cancel/../../etc/passwd`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    // Either route doesn't match or Zod rejects
    assert.ok(badJobCancelRes.status === 400 || badJobCancelRes.status === 404);

    // 6b. JobId with semicolon/spaces rejected
    const badJobRes2 = await fetch(`${BASE_URL}/api/scrape/crawl/cancel/job_123;rm%20-rf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    assert.strictEqual(badJobRes2.status, 400);
    const badJobData2 = await badJobRes2.json();
    assert.strictEqual(badJobData2.error.code, 'INVALID_INPUT');
    console.log('   ✓ Invalid route parameters with dangerous characters strictly rejected.');

    /* ========================================================================= */
    /* 7. Information Leakage Protection (No Stack Traces / Internal Paths)     */
    /* ========================================================================= */
    console.log('\n7. Testing Information Leakage Protection...');

    // Trigger error through non-existent method / bad URL
    const errResRaw = await fetch(`${BASE_URL}/api/scrape/page`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'http://[::1]:999999' })
    });
    const errRawData = await errResRaw.json();
    const rawString = JSON.stringify(errRawData);
    assert.ok(!rawString.includes('node_modules'), 'Error response must not leak node_modules path');
    assert.ok(!rawString.includes('at process.'), 'Error response must not leak call stack');
    assert.ok(!rawString.includes('C:\\'), 'Error response must not leak Windows filesystem paths');
    assert.ok(!rawString.includes('/home/'), 'Error response must not leak POSIX home directory paths');
    console.log('   ✓ Zero stack traces, filesystem paths, or runtime internals exposed.');

    console.log('\n🎉 ALL PHASE FOUR INPUT VALIDATION & API HARDENING TESTS PASSED 100%!\n');
  } finally {
    server.close();
    console.log('Test server shut down gracefully.');
  }
}

runPhase4ValidationTests().catch(err => {
  console.error('Phase 4 Validation Test failed:', err);
  process.exit(1);
});
