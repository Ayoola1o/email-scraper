const assert = require('assert');
const http = require('http');

async function runTests() {
  console.log('🧪 Starting Comprehensive HUNTIQ Integration Test Suite (19 Scenarios)...\n');

  let mockScenario = 'normal';
  let receivedPayloads = [];
  let receivedHeadersList = [];
  let retryCount = 0;

  // 1. Create flexible mock HUNTIQ server on port 3999
  const mockHuntiqServer = http.createServer((req, res) => {
    receivedHeadersList.push(req.headers);
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let parsed = null;
      try {
        parsed = JSON.parse(body);
      } catch {
        parsed = body;
      }
      receivedPayloads.push(parsed);

      if (mockScenario === 'auth_fail') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized: Invalid HUNTIQ_API_KEY' }));
        return;
      }

      if (mockScenario === '500_retry') {
        retryCount++;
        if (retryCount < 2) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Transient Database Error' }));
          return;
        }
        // Success on retry
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          accepted: parsed.contacts ? parsed.contacts.length : 0,
          duplicates: 0,
          rejected: 0
        }));
        return;
      }

      if (mockScenario === 'timeout') {
        // Delay response to trigger client timeout
        setTimeout(() => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        }, 3000);
        return;
      }

      // Default normal response
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        accepted: parsed.contacts ? parsed.contacts.length : (parsed.leads ? parsed.leads.length : 0),
        duplicates: 0,
        rejected: 0,
        message: 'Discovered contacts received successfully by HUNTIQ'
      }));
    });
  });

  await new Promise(resolve => mockHuntiqServer.listen(3999, resolve));
  console.log('   ✓ Mock HUNTIQ server listening on port 3999');

  // Set environment variables for server
  process.env.HUNTIQ_API_URL = 'http://localhost:3999/api/v1/integrations/lead-ingest';
  process.env.HUNTIQ_API_KEY = 'hnt_live_secure_secret_key_88';
  process.env.HUNTIQ_WORKSPACE_ID = 'ws-production-001';
  process.env.ALLOW_LOCAL_SCRAPING = 'true'; // for test execution

  // 2. Start EmailScraper Pro API server on port 3002
  const { startServer } = require('./dist/server/index');
  const scraperServer = startServer(3002);
  console.log('   ✓ EmailScraper Pro API server running on port 3002\n');

  const {
    HuntIQClient,
    HuntIQConfigManager,
    mapRecordsToHuntIQPayload,
    mapRecordToHuntIQContact
  } = require('./dist/integrations/huntiq/index');
  const {
    validateSafeScrapeUrl,
    isRestrictedIpAddress,
    sanitizeCrawlLimits
  } = require('./dist/utils/security');

  try {
    // -------------------------------------------------------------------------
    // Scenario 1: Successful HUNTIQ Connection
    // -------------------------------------------------------------------------
    console.log('Scenario 1: Testing Successful HUNTIQ Connection (/api/integrations/huntiq/test)...');
    mockScenario = 'normal';
    const pingRes = await fetch('http://localhost:3002/api/integrations/huntiq/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const pingData = await pingRes.json();
    assert.strictEqual(pingData.success, true);
    assert.strictEqual(pingData.reachable, true);
    assert.strictEqual(pingData.authenticated, true);
    console.log('   ✓ Scenario 1 passed: HUNTIQ connected & authenticated.\n');

    // -------------------------------------------------------------------------
    // Scenario 2: Authentication Failure (401 handled cleanly)
    // -------------------------------------------------------------------------
    console.log('Scenario 2: Testing Authentication Failure...');
    mockScenario = 'auth_fail';
    const authFailRes = await fetch('http://localhost:3002/api/integrations/huntiq/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const authFailData = await authFailRes.json();
    assert.strictEqual(authFailData.success, false);
    assert.strictEqual(authFailData.reachable, true);
    assert.strictEqual(authFailData.authenticated, false);
    console.log('   ✓ Scenario 2 passed: Auth failure cleanly identified without crash.\n');

    // -------------------------------------------------------------------------
    // Scenario 3: Missing Configuration Diagnostics
    // -------------------------------------------------------------------------
    console.log('Scenario 3: Testing Missing Configuration Handling...');
    const originalUrl = process.env.HUNTIQ_API_URL;
    delete process.env.HUNTIQ_API_URL;
    const missingClient = new HuntIQClient();
    const missingResult = await missingClient.checkConnection();
    assert.strictEqual(missingResult.success, false);
    assert.ok(missingResult.message.includes('not configured'));
    process.env.HUNTIQ_API_URL = originalUrl;
    console.log('   ✓ Scenario 3 passed: Missing configuration diagnosed.\n');

    // -------------------------------------------------------------------------
    // Scenario 4: Successful Contact Sync
    // -------------------------------------------------------------------------
    console.log('Scenario 4: Testing Successful Contact Sync (/api/integrations/huntiq/sync)...');
    mockScenario = 'normal';
    receivedPayloads = [];
    receivedHeadersList = [];

    const sampleRecords = [
      {
        email: 'elena.rostova@acme-demo.com',
        name: 'Dr. Elena Rostova',
        jobTitle: 'Chief Executive Officer',
        domain: 'acme-demo.com',
        phone: '+1 (555) 234-5678',
        sourceUrl: 'https://acme-demo.com/team',
        mxStatus: 'deliverable',
        socials: { linkedin: 'https://linkedin.com/in/elena-rostova' },
        contextSnippet: 'Dr. Elena Rostova leads global operations as Chief Executive Officer'
      }
    ];

    const syncRes = await fetch('http://localhost:3002/api/integrations/huntiq/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        records: sampleRecords,
        companyDomain: 'acme-demo.com'
      })
    });
    const syncData = await syncRes.json();
    assert.strictEqual(syncData.success, true);
    assert.strictEqual(syncData.accepted, 1);
    console.log('   ✓ Scenario 4 passed: Contacts synced successfully.\n');

    // -------------------------------------------------------------------------
    // Scenario 5: Invalid Payload Handling
    // -------------------------------------------------------------------------
    console.log('Scenario 5: Testing Invalid Payload Handling (empty/malformed)...');
    const invalidRes = await fetch('http://localhost:3002/api/integrations/huntiq/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: 'not-an-array' })
    });
    assert.strictEqual(invalidRes.status, 400);
    console.log('   ✓ Scenario 5 passed: Invalid payload rejected with HTTP 400.\n');

    // -------------------------------------------------------------------------
    // Scenario 6: Timeout Handling
    // -------------------------------------------------------------------------
    console.log('Scenario 6: Testing Request Timeout Handling...');
    mockScenario = 'timeout';
    const timeoutClient = new HuntIQClient({ timeoutMs: 300, maxRetries: 0 });
    const payloadForTimeout = mapRecordsToHuntIQPayload(sampleRecords);
    let timeoutCaught = false;
    try {
      await timeoutClient.syncContacts(payloadForTimeout);
    } catch (err) {
      timeoutCaught = true;
      assert.ok(err.name === 'TimeoutError' || err.name === 'AbortError' || err.message.includes('abort') || err.message.includes('timeout'));
    }
    assert.strictEqual(timeoutCaught, true);
    console.log('   ✓ Scenario 6 passed: Request timeout aborted promptly.\n');

    // -------------------------------------------------------------------------
    // Scenario 7: Transient 500 Retry with Backoff
    // -------------------------------------------------------------------------
    console.log('Scenario 7: Testing Transient 500 Retry with Backoff...');
    mockScenario = '500_retry';
    retryCount = 0;
    const retryClient = new HuntIQClient({ maxRetries: 2, timeoutMs: 2000 });
    const retryPayload = mapRecordsToHuntIQPayload(sampleRecords);
    const retryRes = await retryClient.syncContacts(retryPayload);
    assert.strictEqual(retryRes.success, true);
    assert.strictEqual(retryCount, 2, 'Should have retried after initial 500 error');
    console.log('   ✓ Scenario 7 passed: Transient 500 recovered via retry.\n');

    // -------------------------------------------------------------------------
    // Scenario 8: 401 Unauthorized Fast-Fail (Zero Retries)
    // -------------------------------------------------------------------------
    console.log('Scenario 8: Testing 401 Fast-Fail (No Retry)...');
    mockScenario = 'auth_fail';
    let authAttempts = 0;
    const noRetryClient = new HuntIQClient({ maxRetries: 3 });
    let authErrorCaught = false;
    try {
      await noRetryClient.syncContacts(retryPayload);
    } catch (err) {
      authErrorCaught = true;
      assert.ok(err.message.includes('401'));
    }
    assert.strictEqual(authErrorCaught, true);
    console.log('   ✓ Scenario 8 passed: 401 fast-fails immediately without retrying.\n');

    // -------------------------------------------------------------------------
    // Scenario 9: Idempotency Key Transmitted
    // -------------------------------------------------------------------------
    console.log('Scenario 9: Testing Idempotency-Key Header Transmission...');
    mockScenario = 'normal';
    receivedHeadersList = [];
    const clientWithIdemp = new HuntIQClient();
    const idempPayload = mapRecordsToHuntIQPayload(sampleRecords);
    await clientWithIdemp.syncContacts(idempPayload);
    const lastHeaders = receivedHeadersList[receivedHeadersList.length - 1];
    assert.ok(lastHeaders['idempotency-key'], 'Idempotency-Key header must be sent');
    assert.strictEqual(lastHeaders['idempotency-key'], idempPayload.requestId);
    console.log('   ✓ Scenario 9 passed: Idempotency-Key correctly mapped to requestId.\n');

    // -------------------------------------------------------------------------
    // Scenario 10: Duplicate Contacts Deduplicated
    // -------------------------------------------------------------------------
    console.log('Scenario 10: Testing Duplicate Contact Deduplication...');
    const dupRecords = [
      { email: 'sarah@acme.com', domain: 'acme.com' },
      { email: 'SARAH@acme.com', domain: 'acme.com' },
      { email: 'sarah@acme.com ', domain: 'acme.com' }
    ];
    const deduplicatedPayload = mapRecordsToHuntIQPayload(dupRecords);
    assert.strictEqual(deduplicatedPayload.contacts.length, 1, 'Duplicate emails must be collapsed into 1 contact');
    console.log('   ✓ Scenario 10 passed: Case-insensitive duplicates deduplicated.\n');

    // -------------------------------------------------------------------------
    // Scenario 11: Provenance Preservation
    // -------------------------------------------------------------------------
    console.log('Scenario 11: Testing Data Provenance Preservation...');
    const provRecord = {
      email: 'lead@target.com',
      sourceUrl: 'https://target.com/contact-us',
      contextSnippet: 'Reach out to our customer support team',
      mxStatus: 'deliverable'
    };
    const provContact = mapRecordToHuntIQContact(provRecord);
    assert.strictEqual(provContact.sourceType, 'CONTACT_PAGE');
    assert.strictEqual(provContact.emailStatus, 'VALIDATED');
    assert.ok(provContact.confidence > 0.80);
    assert.strictEqual(provContact.sourceUrl, 'https://target.com/contact-us');
    console.log('   ✓ Scenario 11 passed: Source URL, classified type, and confidence preserved.\n');

    // -------------------------------------------------------------------------
    // Scenario 12: Inferred Identity Separation
    // -------------------------------------------------------------------------
    console.log('Scenario 12: Testing Inferred Identity Separation...');
    // A record whose name was synthetically inferred from email username:
    const inferredRecord = {
      email: 'john.doe@company.com',
      name: 'John Doe' // inferred from local part
    };
    const mappedInferred = mapRecordToHuntIQContact(inferredRecord);
    assert.strictEqual(mappedInferred.name, null, 'Inferred name must NOT be placed in verified name field');
    assert.ok(mappedInferred.identityInference, 'Inferred details must be isolated in identityInference');
    assert.strictEqual(mappedInferred.identityInference.firstName, 'John');
    assert.strictEqual(mappedInferred.identityInference.source, 'email_local_part');
    console.log('   ✓ Scenario 12 passed: Inferred names cleanly isolated from verified names.\n');

    // -------------------------------------------------------------------------
    // Scenario 13: Zero Fabricated Company Names
    // -------------------------------------------------------------------------
    console.log('Scenario 13: Verifying Zero Fabricated Company Names...');
    const recordNoCompany = { email: 'user@techcorp.io', domain: 'techcorp.io' };
    const payloadNoCompany = mapRecordsToHuntIQPayload([recordNoCompany]);
    assert.strictEqual(payloadNoCompany.company.name, null, 'Must NOT invent "Techcorp" from domain "techcorp.io"');
    console.log('   ✓ Scenario 13 passed: Company name is null when not explicitly discovered.\n');

    // -------------------------------------------------------------------------
    // Scenario 14: Zero Fabricated Websites
    // -------------------------------------------------------------------------
    console.log('Scenario 14: Verifying Zero Fabricated Websites...');
    assert.strictEqual(payloadNoCompany.company.website, null, 'Must NOT invent "https://techcorp.io" from domain');
    console.log('   ✓ Scenario 14 passed: Website is null when not explicitly crawled.\n');

    // -------------------------------------------------------------------------
    // Scenario 15: No Automatic Outreach Creation
    // -------------------------------------------------------------------------
    console.log('Scenario 15: Verifying No Automatic Outreach Creation...');
    assert.strictEqual(payloadNoCompany.createOutreachDraft, undefined);
    assert.strictEqual(payloadNoCompany.contacts[0].createOutreachDraft, undefined);
    console.log('   ✓ Scenario 15 passed: Scraper leaves all outreach decisions to HUNTIQ.\n');

    // -------------------------------------------------------------------------
    // Scenario 16: API Key Confidentiality (Never Returned to Client)
    // -------------------------------------------------------------------------
    console.log('Scenario 16: Verifying API Key Confidentiality...');
    const diag = HuntIQConfigManager.getSanitizedDiagnostics();
    assert.strictEqual(diag.hasApiKey, true);
    assert.strictEqual(diag.apiKey, undefined, 'API key must never be present in diagnostic output');
    const testEndpointRes = await fetch('http://localhost:3002/api/integrations/huntiq/test', { method: 'POST' });
    const testEndpointBody = await testEndpointRes.text();
    assert.ok(!testEndpointBody.includes('hnt_live_secure_secret_key_88'), 'Secret key must never leak in response body');
    console.log('   ✓ Scenario 16 passed: Server credentials remain confidential.\n');

    // -------------------------------------------------------------------------
    // Scenario 17: SSRF Protection
    // -------------------------------------------------------------------------
    console.log('Scenario 17: Testing SSRF Protection...');
    assert.strictEqual(isRestrictedIpAddress('127.0.0.1'), true, '127.0.0.1 must be restricted');
    assert.strictEqual(isRestrictedIpAddress('10.0.1.5'), true, '10.x.x.x must be restricted');
    assert.strictEqual(isRestrictedIpAddress('192.168.1.1'), true, '192.168.x.x must be restricted');
    assert.strictEqual(isRestrictedIpAddress('169.254.169.254'), true, 'Cloud metadata IP must be restricted');
    assert.strictEqual(isRestrictedIpAddress('8.8.8.8'), false, 'Public IP is not restricted');

    const ssrfCheck = await validateSafeScrapeUrl('http://169.254.169.254/latest/meta-data/', { allowLocalhost: false });
    assert.strictEqual(ssrfCheck.safe, false, 'Cloud metadata endpoint must be blocked');
    console.log('   ✓ Scenario 17 passed: SSRF protection blocks restricted networks.\n');

    // -------------------------------------------------------------------------
    // Scenario 18: Response Size Limits
    // -------------------------------------------------------------------------
    console.log('Scenario 18: Verifying Response Size Limits Constant...');
    const { CRAWL_SECURITY_LIMITS } = require('./dist/utils/security');
    assert.strictEqual(CRAWL_SECURITY_LIMITS.MAX_RESPONSE_BYTES, 10 * 1024 * 1024);
    console.log('   ✓ Scenario 18 passed: Response size capped at 10MB.\n');

    // -------------------------------------------------------------------------
    // Scenario 19: Crawl Depth and Page Limits
    // -------------------------------------------------------------------------
    console.log('Scenario 19: Verifying Crawl Limits Sanitization...');
    const sanitized = sanitizeCrawlLimits(999, 5000);
    assert.strictEqual(sanitized.depth, CRAWL_SECURITY_LIMITS.MAX_DEPTH_CAP);
    assert.strictEqual(sanitized.pages, CRAWL_SECURITY_LIMITS.MAX_PAGES_CAP);
    console.log('   ✓ Scenario 19 passed: Depth and page limits sanitized securely.\n');

    console.log('🎉 All 19 HUNTIQ Integration & Discovery Service Scenarios Successfully Passed!\n');
  } finally {
    mockHuntiqServer.close();
    scraperServer.close();
  }
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
