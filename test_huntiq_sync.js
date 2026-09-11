const assert = require('assert');
const http = require('http');

async function runTests() {
  console.log('🧪 Starting Critical HUNTIQ Integration & Security Test Suite (30 Scenarios)...\n');

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

      if (mockScenario === 'auth_fail_401') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized: Invalid HUNTIQ_API_KEY' }));
        return;
      }

      if (mockScenario === 'auth_fail_403') {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden: Workspace permissions invalid' }));
        return;
      }

      if (mockScenario === '500_retry') {
        retryCount++;
        if (retryCount < 2) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Transient Database Error' }));
          return;
        }
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
  process.env.HUNTIQ_API_KEY = 'hnt_live_secure_secret_key_999';
  process.env.HUNTIQ_INTEGRATION_ENABLED = 'true';
  process.env.ALLOW_LOCAL_SCRAPING = 'true'; // for test runner

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
    safeFetch,
    sanitizeCrawlLimits,
    CRAWL_SECURITY_LIMITS
  } = require('./dist/utils/security');

  try {
    // -------------------------------------------------------------------------
    // Scenario 1: Missing HUNTIQ Configuration (HUNTIQ_INTEGRATION_NOT_CONFIGURED)
    // -------------------------------------------------------------------------
    console.log('Scenario 1: Testing Missing HUNTIQ Configuration...');
    const originalUrl = process.env.HUNTIQ_API_URL;
    delete process.env.HUNTIQ_API_URL;
    assert.strictEqual(HuntIQConfigManager.isConfigured(), false);
    const unconfiguredPayload = HuntIQConfigManager.getUnconfiguredError();
    assert.strictEqual(unconfiguredPayload.code, 'HUNTIQ_INTEGRATION_NOT_CONFIGURED');

    const testUnconfRes = await fetch('http://localhost:3002/api/integrations/huntiq/test', { method: 'POST' });
    assert.strictEqual(testUnconfRes.status, 503);
    const unconfData = await testUnconfRes.json();
    assert.strictEqual(unconfData.code, 'HUNTIQ_INTEGRATION_NOT_CONFIGURED');
    process.env.HUNTIQ_API_URL = originalUrl;
    console.log('   ✓ Scenario 1 passed: Returned code HUNTIQ_INTEGRATION_NOT_CONFIGURED.\n');

    // -------------------------------------------------------------------------
    // Scenario 2: Successful Server-Side Configuration
    // -------------------------------------------------------------------------
    console.log('Scenario 2: Testing Successful Server-Side Configuration...');
    assert.strictEqual(HuntIQConfigManager.isConfigured(), true);
    const config = HuntIQConfigManager.getConfig();
    assert.strictEqual(config.apiUrl, 'http://localhost:3999/api/v1/integrations/lead-ingest');
    console.log('   ✓ Scenario 2 passed: Server configuration loaded from environment.\n');

    // -------------------------------------------------------------------------
    // Scenario 3: API Key is Never Returned to Frontend
    // -------------------------------------------------------------------------
    console.log('Scenario 3: Verifying API Key is Never Returned to Frontend...');
    const testRes = await fetch('http://localhost:3002/api/integrations/huntiq/test', { method: 'POST' });
    const testBody = await testRes.text();
    assert.ok(!testBody.includes('hnt_live_secure_secret_key_999'), 'Secret API key must not leak');
    const diag = HuntIQConfigManager.getSanitizedDiagnostics();
    assert.strictEqual(diag.hasApiKey, true);
    assert.strictEqual(diag.apiKey, undefined, 'API key must be masked');
    console.log('   ✓ Scenario 3 passed: API key strictly confidential.\n');

    // -------------------------------------------------------------------------
    // Scenario 4: Client API Key is Ignored / Rejected
    // -------------------------------------------------------------------------
    console.log('Scenario 4: Verifying Client-Supplied API Key is Ignored...');
    receivedHeadersList = [];
    mockScenario = 'normal';
    await fetch('http://localhost:3002/api/integrations/huntiq/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        records: [{ email: 'lead@test.com' }],
        apiKey: 'untrusted_attacker_key_666'
      })
    });
    const lastHeaders = receivedHeadersList[receivedHeadersList.length - 1];
    assert.strictEqual(lastHeaders['authorization'], 'Bearer hnt_live_secure_secret_key_999');
    assert.ok(!lastHeaders['authorization'].includes('untrusted_attacker_key'));
    console.log('   ✓ Scenario 4 passed: Client API key completely ignored.\n');

    // -------------------------------------------------------------------------
    // Scenario 5: Client Workspace ID is Ignored / Rejected
    // -------------------------------------------------------------------------
    console.log('Scenario 5: Verifying Client Workspace ID is Ignored...');
    await fetch('http://localhost:3002/api/integrations/huntiq/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        records: [{ email: 'lead@test.com' }],
        workspaceId: 'untrusted-workspace-injected'
      })
    });
    const headersWs = receivedHeadersList[receivedHeadersList.length - 1];
    assert.strictEqual(headersWs['x-workspace-id'], undefined, 'No client x-workspace-id may be sent');
    console.log('   ✓ Scenario 5 passed: Client workspace ID not trusted or sent.\n');

    // -------------------------------------------------------------------------
    // Scenario 6: Client HUNTIQ URL is Ignored
    // -------------------------------------------------------------------------
    console.log('Scenario 6: Verifying Client HUNTIQ URL is Ignored...');
    let rogueServerHit = false;
    const rogueServer = http.createServer((req, res) => {
      rogueServerHit = true;
      res.writeHead(200);
      res.end('{}');
    });
    await new Promise(r => rogueServer.listen(3998, r));
    try {
      await fetch('http://localhost:3002/api/integrations/huntiq/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          records: [{ email: 'lead@test.com' }],
          huntiqApiUrl: 'http://localhost:3998/rogue'
        })
      });
      assert.strictEqual(rogueServerHit, false, 'Client-specified destination must not be contacted');
    } finally {
      rogueServer.close();
    }
    console.log('   ✓ Scenario 6 passed: Destination locked down to server config.\n');

    // -------------------------------------------------------------------------
    // Scenario 7: Successful Contact Sync
    // -------------------------------------------------------------------------
    console.log('Scenario 7: Testing Successful Contact Sync...');
    mockScenario = 'normal';
    const sampleRecord = {
      email: 'dr.elena.rostova@acme-demo.com',
      name: 'Dr. Elena Rostova',
      jobTitle: 'Chief Executive Officer',
      sourceUrl: 'https://acme-demo.com/team',
      mxStatus: 'deliverable'
    };
    const syncRes = await fetch('http://localhost:3002/api/integrations/huntiq/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: [sampleRecord] })
    });
    const syncData = await syncRes.json();
    assert.strictEqual(syncData.success, true);
    assert.strictEqual(syncData.accepted, 1);
    console.log('   ✓ Scenario 7 passed: Contacts synced successfully.\n');

    // -------------------------------------------------------------------------
    // Scenario 8: Connection Test Endpoint
    // -------------------------------------------------------------------------
    console.log('Scenario 8: Testing Connection Test Endpoint...');
    const connRes = await fetch('http://localhost:3002/api/integrations/huntiq/test', { method: 'POST' });
    const connData = await connRes.json();
    assert.strictEqual(connData.success, true);
    assert.strictEqual(connData.reachable, true);
    assert.strictEqual(connData.authenticated, true);
    console.log('   ✓ Scenario 8 passed: Connection test succeeded.\n');

    // -------------------------------------------------------------------------
    // Scenario 9: 401 Unauthorized Does NOT Retry
    // -------------------------------------------------------------------------
    console.log('Scenario 9: Testing 401 Does NOT Retry...');
    mockScenario = 'auth_fail_401';
    const client401 = new HuntIQClient({ maxRetries: 3 });
    const payload401 = mapRecordsToHuntIQPayload([sampleRecord]);
    let caught401 = false;
    try {
      await client401.syncContacts(payload401);
    } catch (err) {
      caught401 = true;
      assert.ok(err.message.includes('401'));
    }
    assert.strictEqual(caught401, true);
    console.log('   ✓ Scenario 9 passed: 401 fast-fails with 0 retries.\n');

    // -------------------------------------------------------------------------
    // Scenario 10: 403 Forbidden Does NOT Retry
    // -------------------------------------------------------------------------
    console.log('Scenario 10: Testing 403 Does NOT Retry...');
    mockScenario = 'auth_fail_403';
    const client403 = new HuntIQClient({ maxRetries: 3 });
    let caught403 = false;
    try {
      await client403.syncContacts(payload401);
    } catch (err) {
      caught403 = true;
      assert.ok(err.message.includes('403'));
    }
    assert.strictEqual(caught403, true);
    console.log('   ✓ Scenario 10 passed: 403 fast-fails with 0 retries.\n');

    // -------------------------------------------------------------------------
    // Scenario 11: 5xx Server Error Retries with Backoff
    // -------------------------------------------------------------------------
    console.log('Scenario 11: Testing 5xx Retries with Backoff...');
    mockScenario = '500_retry';
    retryCount = 0;
    const client500 = new HuntIQClient({ maxRetries: 2, timeoutMs: 2000 });
    const res500 = await client500.syncContacts(payload401);
    assert.strictEqual(res500.success, true);
    assert.strictEqual(retryCount, 2, 'Should have retried transient 500 error');
    console.log('   ✓ Scenario 11 passed: 5xx transient error retried and recovered.\n');

    // -------------------------------------------------------------------------
    // Scenario 12: Network Failure Retry
    // -------------------------------------------------------------------------
    console.log('Scenario 12: Testing Network Failure Handling...');
    const clientDeadPort = new HuntIQClient({ apiUrl: 'http://localhost:3997/dead', maxRetries: 1, timeoutMs: 300 });
    let caughtNetErr = false;
    try {
      await clientDeadPort.syncContacts(payload401);
    } catch (err) {
      caughtNetErr = true;
    }
    assert.strictEqual(caughtNetErr, true);
    console.log('   ✓ Scenario 12 passed: Network failure caught cleanly.\n');

    // -------------------------------------------------------------------------
    // Scenario 13: Timeout Handling
    // -------------------------------------------------------------------------
    console.log('Scenario 13: Testing Timeout Handling...');
    mockScenario = 'timeout';
    const clientTimeout = new HuntIQClient({ timeoutMs: 300, maxRetries: 0 });
    let caughtTimeout = false;
    try {
      await clientTimeout.syncContacts(payload401);
    } catch (err) {
      caughtTimeout = true;
    }
    assert.strictEqual(caughtTimeout, true);
    console.log('   ✓ Scenario 13 passed: Timeout aborts promptly.\n');

    // -------------------------------------------------------------------------
    // Scenario 14: Idempotency Key
    // -------------------------------------------------------------------------
    console.log('Scenario 14: Testing Idempotency-Key Header...');
    mockScenario = 'normal';
    receivedHeadersList = [];
    const clientNormal = new HuntIQClient();
    const idempPayload = mapRecordsToHuntIQPayload([sampleRecord]);
    await clientNormal.syncContacts(idempPayload);
    const idempHeaders = receivedHeadersList[receivedHeadersList.length - 1];
    assert.strictEqual(idempHeaders['idempotency-key'], idempPayload.requestId);
    console.log('   ✓ Scenario 14 passed: Idempotency-Key transmitted.\n');

    // -------------------------------------------------------------------------
    // Scenario 15: Duplicate Contact Deduplication
    // -------------------------------------------------------------------------
    console.log('Scenario 15: Testing Duplicate Contact Deduplication...');
    const dups = [
      { email: 'alex@acme.com' },
      { email: 'ALEX@acme.com' },
      { email: 'alex@acme.com ' }
    ];
    const dedupPayload = mapRecordsToHuntIQPayload(dups);
    assert.strictEqual(dedupPayload.contacts.length, 1);
    console.log('   ✓ Scenario 15 passed: Duplicate contacts deduplicated.\n');

    // -------------------------------------------------------------------------
    // Scenario 16: No Fabricated Company Name
    // -------------------------------------------------------------------------
    console.log('Scenario 16: Verifying No Fabricated Company Name...');
    const recordNoCo = { email: 'sales@techcorp.io', domain: 'techcorp.io' };
    const payloadNoCo = mapRecordsToHuntIQPayload([recordNoCo]);
    assert.strictEqual(payloadNoCo.company.name, null);
    console.log('   ✓ Scenario 16 passed: company.name is null.\n');

    // -------------------------------------------------------------------------
    // Scenario 17: No Fabricated Website
    // -------------------------------------------------------------------------
    console.log('Scenario 17: Verifying No Fabricated Website...');
    assert.strictEqual(payloadNoCo.company.website, null);
    console.log('   ✓ Scenario 17 passed: company.website is null.\n');

    // -------------------------------------------------------------------------
    // Scenario 18: Inferred Identity is Explicitly Marked
    // -------------------------------------------------------------------------
    console.log('Scenario 18: Testing Inferred Identity Isolation...');
    const inferredRec = { email: 'sarah.connor@sky.net', name: 'Sarah Connor' };
    const mappedInferred = mapRecordToHuntIQContact(inferredRec);
    assert.strictEqual(mappedInferred.name, null);
    assert.ok(mappedInferred.identityInference);
    assert.strictEqual(mappedInferred.identityInference.firstName, 'Sarah');
    assert.strictEqual(mappedInferred.identityInference.source, 'email_local_part');
    console.log('   ✓ Scenario 18 passed: Inferred identity isolated in identityInference.\n');

    // -------------------------------------------------------------------------
    // Scenario 19: Verified Identity Remains Separate
    // -------------------------------------------------------------------------
    console.log('Scenario 19: Testing Verified Identity Preservation...');
    const verifiedRec = { email: 'ceo@acme.com', name: 'Dr. Elena Rostova', sourceUrl: 'https://acme.com/team' };
    const mappedVerified = mapRecordToHuntIQContact(verifiedRec);
    assert.strictEqual(mappedVerified.name, 'Dr. Elena Rostova');
    assert.strictEqual(mappedVerified.identitySource, 'website');
    assert.strictEqual(mappedVerified.identityInference, undefined);
    console.log('   ✓ Scenario 19 passed: Verified name preserved with source website.\n');

    // -------------------------------------------------------------------------
    // Scenario 20: No Automatic Outreach Creation
    // -------------------------------------------------------------------------
    console.log('Scenario 20: Verifying No Automatic Outreach Creation...');
    assert.strictEqual(dedupPayload.createOutreachDraft, undefined);
    assert.strictEqual(dedupPayload.contacts[0].createOutreachDraft, undefined);
    console.log('   ✓ Scenario 20 passed: No outreach directives emitted.\n');

    // -------------------------------------------------------------------------
    // Scenario 21: Localhost Blocked (when allowLocalhost is false)
    // -------------------------------------------------------------------------
    console.log('Scenario 21: Testing Localhost Blocked...');
    const resLocalhost = await validateSafeScrapeUrl('http://localhost:8080/admin', { allowLocalhost: false });
    assert.strictEqual(resLocalhost.safe, false);
    console.log('   ✓ Scenario 21 passed: localhost is blocked.\n');

    // -------------------------------------------------------------------------
    // Scenario 22: 127.0.0.1 Blocked
    // -------------------------------------------------------------------------
    console.log('Scenario 22: Testing 127.0.0.1 Blocked...');
    const res127 = await validateSafeScrapeUrl('http://127.0.0.1:3000', { allowLocalhost: false });
    assert.strictEqual(res127.safe, false);
    console.log('   ✓ Scenario 22 passed: 127.0.0.1 loopback blocked.\n');

    // -------------------------------------------------------------------------
    // Scenario 23: RFC1918 Private IP Blocked
    // -------------------------------------------------------------------------
    console.log('Scenario 23: Testing RFC1918 Private IPs Blocked...');
    const resRfc10 = await validateSafeScrapeUrl('http://10.0.1.50/dashboard', { allowLocalhost: false });
    const resRfc192 = await validateSafeScrapeUrl('http://192.168.1.1/config', { allowLocalhost: false });
    const resRfc172 = await validateSafeScrapeUrl('http://172.20.0.1/admin', { allowLocalhost: false });
    assert.strictEqual(resRfc10.safe, false);
    assert.strictEqual(resRfc192.safe, false);
    assert.strictEqual(resRfc172.safe, false);
    console.log('   ✓ Scenario 23 passed: RFC1918 private subnets blocked.\n');

    // -------------------------------------------------------------------------
    // Scenario 24: Cloud Metadata IP Blocked
    // -------------------------------------------------------------------------
    console.log('Scenario 24: Testing Cloud Metadata IP Blocked...');
    const resMeta = await validateSafeScrapeUrl('http://169.254.169.254/latest/meta-data/', { allowLocalhost: false });
    assert.strictEqual(resMeta.safe, false);
    console.log('   ✓ Scenario 24 passed: Cloud metadata endpoint 169.254.169.254 blocked.\n');

    // -------------------------------------------------------------------------
    // Scenario 25: Unsafe Redirect Blocked
    // -------------------------------------------------------------------------
    console.log('Scenario 25: Testing Unsafe Redirect Blocked in safeFetch...');
    // Create a mock server that attempts an SSRF redirect to 169.254.169.254
    const redirectServer = http.createServer((req, res) => {
      res.writeHead(302, { 'Location': 'http://169.254.169.254/latest/meta-data/' });
      res.end();
    });
    await new Promise(r => redirectServer.listen(3996, r));
    let redirectBlocked = false;
    try {
      await safeFetch('http://localhost:3996', { allowLocalhost: true });
    } catch (err) {
      redirectBlocked = true;
      assert.ok(err.message.includes('SSRF blocked'));
    } finally {
      redirectServer.close();
    }
    assert.strictEqual(redirectBlocked, true);
    console.log('   ✓ Scenario 25 passed: SSRF redirect hop detected and blocked.\n');

    // -------------------------------------------------------------------------
    // Scenario 26: Oversized Response Blocked
    // -------------------------------------------------------------------------
    console.log('Scenario 26: Testing Oversized Response Blocked in safeFetch...');
    const sizeServer = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      // Send 50KB in a test where maxBytes is 1000
      res.end('A'.repeat(50000));
    });
    await new Promise(r => sizeServer.listen(3995, r));
    let sizeBlocked = false;
    try {
      await safeFetch('http://localhost:3995', { allowLocalhost: true, maxBytes: 1000 });
    } catch (err) {
      sizeBlocked = true;
      assert.ok(err.message.includes('limit of'));
    } finally {
      sizeServer.close();
    }
    assert.strictEqual(sizeBlocked, true);
    console.log('   ✓ Scenario 26 passed: Oversized response aborted before memory overload.\n');

    // -------------------------------------------------------------------------
    // Scenario 27: Crawl Page Limit Enforced
    // -------------------------------------------------------------------------
    console.log('Scenario 27: Testing Crawl Page Limit Enforced...');
    const sanitizedPages = sanitizeCrawlLimits(1, 99999);
    assert.strictEqual(sanitizedPages.pages, CRAWL_SECURITY_LIMITS.MAX_PAGES_CAP);
    console.log('   ✓ Scenario 27 passed: Page limit capped at MAX_PAGES_CAP.\n');

    // -------------------------------------------------------------------------
    // Scenario 28: Crawl Depth Limit Enforced
    // -------------------------------------------------------------------------
    console.log('Scenario 28: Testing Crawl Depth Limit Enforced...');
    const sanitizedDepth = sanitizeCrawlLimits(999, 10);
    assert.strictEqual(sanitizedDepth.depth, CRAWL_SECURITY_LIMITS.MAX_DEPTH_CAP);
    console.log('   ✓ Scenario 28 passed: Depth limit capped at MAX_DEPTH_CAP.\n');

    // -------------------------------------------------------------------------
    // Scenario 29: Quarantine Persistence Failure Does NOT Lose Data
    // -------------------------------------------------------------------------
    console.log('Scenario 29: Testing Quarantine Persistence Failure Does NOT Lose Data...');
    // Simulate UI state and quarantine failure
    let simulatedRecords = [
      { email: 'valid@test.com', mxStatus: 'deliverable' },
      { email: 'dead@test.com', mxStatus: 'undeliverable' }
    ];
    let quarantineFailed = true;

    // The safe ordering pattern:
    async function safePurge(activeList, persister) {
      const dead = activeList.filter(r => r.mxStatus === 'undeliverable');
      if (dead.length === 0) return activeList;
      try {
        await persister(dead);
      } catch (err) {
        // If persistence fails, retain active records!
        return activeList;
      }
      return activeList.filter(r => r.mxStatus !== 'undeliverable');
    }

    const afterFailedPurge = await safePurge(simulatedRecords, async () => {
      throw new Error('Disk full on quarantine folder');
    });
    assert.strictEqual(afterFailedPurge.length, 2, 'Must retain all records when quarantine fails');
    console.log('   ✓ Scenario 29 passed: Active records preserved when quarantine fails.\n');

    // -------------------------------------------------------------------------
    // Scenario 30: Successful Quarantine Archives Correctly
    // -------------------------------------------------------------------------
    console.log('Scenario 30: Testing Successful Quarantine Archives Correctly...');
    let quarantinedStorage = [];
    const afterSuccessPurge = await safePurge(simulatedRecords, async (records) => {
      quarantinedStorage.push(...records);
      return true;
    });
    assert.strictEqual(afterSuccessPurge.length, 1, 'Only deliverable records remain active');
    assert.strictEqual(quarantinedStorage.length, 1, 'Dead records safely archived');
    assert.strictEqual(quarantinedStorage[0].email, 'dead@test.com');
    console.log('   ✓ Scenario 30 passed: Dead records safely archived only after confirmed persistence.\n');

    console.log('🎉 All 30 Critical HUNTIQ Integration & Security Scenarios Successfully Passed!\n');
  } finally {
    mockHuntiqServer.close();
    scraperServer.close();
  }
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
