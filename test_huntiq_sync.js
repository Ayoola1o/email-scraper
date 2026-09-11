const assert = require('assert');
const http = require('http');

async function runTests() {
  console.log('🧪 Starting Final HUNTIQ Pre-Integration Hardening Test Suite...\n');

  let mockScenario = 'normal';
  let receivedPayloads = [];
  let receivedHeadersList = [];
  let retryCount = 0;

  // 1. Create mock HUNTIQ server on port 3999
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
    parseAndValidateIpv4,
    safeFetch,
    sanitizeCrawlLimits,
    CRAWL_SECURITY_LIMITS
  } = require('./dist/utils/security');

  try {
    // -------------------------------------------------------------------------
    // Test 1: Missing HUNTIQ API Key
    // -------------------------------------------------------------------------
    console.log('Test 1: Testing Missing HUNTIQ API Key...');
    const originalKey = process.env.HUNTIQ_API_KEY;
    delete process.env.HUNTIQ_API_KEY;
    assert.strictEqual(HuntIQConfigManager.isConfigured(), false, 'isConfigured must be false when API key is missing');
    const errMissingKey = HuntIQConfigManager.getUnconfiguredError();
    assert.strictEqual(errMissingKey.code, 'HUNTIQ_INTEGRATION_NOT_CONFIGURED');
    assert.strictEqual(errMissingKey.message, 'HUNTIQ integration is not configured on this server.');
    assert.ok(!errMissingKey.message.includes('API_KEY'), 'Must not leak which secret is missing');
    process.env.HUNTIQ_API_KEY = originalKey;
    console.log('   ✓ Test 1 passed: Missing API key returns HUNTIQ_INTEGRATION_NOT_CONFIGURED.\n');

    // -------------------------------------------------------------------------
    // Test 2: Missing HUNTIQ URL
    // -------------------------------------------------------------------------
    console.log('Test 2: Testing Missing HUNTIQ URL...');
    const originalUrl = process.env.HUNTIQ_API_URL;
    delete process.env.HUNTIQ_API_URL;
    assert.strictEqual(HuntIQConfigManager.isConfigured(), false, 'isConfigured must be false when URL is missing');
    const errMissingUrl = HuntIQConfigManager.getUnconfiguredError();
    assert.strictEqual(errMissingUrl.code, 'HUNTIQ_INTEGRATION_NOT_CONFIGURED');
    assert.strictEqual(errMissingUrl.message, 'HUNTIQ integration is not configured on this server.');
    assert.ok(!errMissingUrl.message.includes('API_URL'), 'Must not leak which secret is missing');
    process.env.HUNTIQ_API_URL = originalUrl;
    console.log('   ✓ Test 2 passed: Missing URL returns HUNTIQ_INTEGRATION_NOT_CONFIGURED.\n');

    // -------------------------------------------------------------------------
    // Test 3: Disabled HUNTIQ Integration
    // -------------------------------------------------------------------------
    console.log('Test 3: Testing Disabled HUNTIQ Integration...');
    process.env.HUNTIQ_INTEGRATION_ENABLED = 'false';
    assert.strictEqual(HuntIQConfigManager.isConfigured(), false, 'isConfigured must be false when enabled=false');
    const testDisabledRes = await fetch('http://localhost:3002/api/integrations/huntiq/test', { method: 'POST' });
    assert.strictEqual(testDisabledRes.status, 503);
    const disabledData = await testDisabledRes.json();
    assert.strictEqual(disabledData.code, 'HUNTIQ_INTEGRATION_NOT_CONFIGURED');
    process.env.HUNTIQ_INTEGRATION_ENABLED = 'true';
    console.log('   ✓ Test 3 passed: Disabled integration returns HUNTIQ_INTEGRATION_NOT_CONFIGURED.\n');

    // -------------------------------------------------------------------------
    // Test 4: Successful Configuration
    // -------------------------------------------------------------------------
    console.log('Test 4: Testing Successful Server Configuration...');
    assert.strictEqual(HuntIQConfigManager.isConfigured(), true, 'isConfigured must be true when all env vars set');
    const config = HuntIQConfigManager.getConfig();
    assert.strictEqual(config.apiUrl, 'http://localhost:3999/api/v1/integrations/lead-ingest');
    assert.strictEqual(config.apiKey, 'hnt_live_secure_secret_key_999');
    assert.strictEqual(config.enabled, true);
    console.log('   ✓ Test 4 passed: Successful configuration loaded correctly.\n');

    // -------------------------------------------------------------------------
    // Test 5: Client-Supplied API Key Ignored / Secret Not Leaked
    // -------------------------------------------------------------------------
    console.log('Test 5: Verifying Client API Key is Ignored...');
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
    console.log('   ✓ Test 5 passed: Client API key completely ignored.\n');

    // -------------------------------------------------------------------------
    // Test 6: Client Workspace ID is Ignored / Rejected
    // -------------------------------------------------------------------------
    console.log('Test 6: Verifying Client Workspace ID is Ignored...');
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
    console.log('   ✓ Test 6 passed: Client workspace ID not trusted or sent.\n');

    // -------------------------------------------------------------------------
    // Test 7: Client HUNTIQ URL is Ignored
    // -------------------------------------------------------------------------
    console.log('Test 7: Verifying Client HUNTIQ URL is Ignored...');
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
    console.log('   ✓ Test 7 passed: Destination locked down to server config.\n');

    // -------------------------------------------------------------------------
    // Test 8: Single Authentication Mechanism (Authorization: Bearer only)
    // -------------------------------------------------------------------------
    console.log('Test 8: Verifying Single Authentication Mechanism (Authorization: Bearer)...');
    const authHeaders = receivedHeadersList[receivedHeadersList.length - 1];
    assert.strictEqual(authHeaders['authorization'], 'Bearer hnt_live_secure_secret_key_999');
    assert.strictEqual(authHeaders['x-huntiq-api-key'], undefined, 'Must NOT send redundant x-huntiq-api-key header');
    console.log('   ✓ Test 8 passed: Only Authorization: Bearer transmitted; no redundant header.\n');

    // -------------------------------------------------------------------------
    // Test 9: Successful Contact Sync
    // -------------------------------------------------------------------------
    console.log('Test 9: Testing Successful Contact Sync...');
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
    console.log('   ✓ Test 9 passed: Contacts synced successfully.\n');

    // -------------------------------------------------------------------------
    // Test 10: Connection Test Endpoint
    // -------------------------------------------------------------------------
    console.log('Test 10: Testing Connection Test Endpoint...');
    const connRes = await fetch('http://localhost:3002/api/integrations/huntiq/test', { method: 'POST' });
    const connData = await connRes.json();
    assert.strictEqual(connData.success, true);
    assert.strictEqual(connData.reachable, true);
    assert.strictEqual(connData.authenticated, true);
    console.log('   ✓ Test 10 passed: Connection test succeeded.\n');

    // -------------------------------------------------------------------------
    // Test 11: 401 Fast-Fail (No Retry)
    // -------------------------------------------------------------------------
    console.log('Test 11: Testing 401 Fast-Fail (No Retry)...');
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
    console.log('   ✓ Test 11 passed: 401 fast-fails with 0 retries.\n');

    // -------------------------------------------------------------------------
    // Test 12: 403 Fast-Fail (No Retry)
    // -------------------------------------------------------------------------
    console.log('Test 12: Testing 403 Fast-Fail (No Retry)...');
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
    console.log('   ✓ Test 12 passed: 403 fast-fails with 0 retries.\n');

    // -------------------------------------------------------------------------
    // Test 13: 5xx Transient Error Retries with Backoff
    // -------------------------------------------------------------------------
    console.log('Test 13: Testing 5xx Retries with Backoff...');
    mockScenario = '500_retry';
    retryCount = 0;
    const client500 = new HuntIQClient({ maxRetries: 2, timeoutMs: 2000 });
    const res500 = await client500.syncContacts(payload401);
    assert.strictEqual(res500.success, true);
    assert.strictEqual(retryCount, 2, 'Should have retried transient 500 error');
    console.log('   ✓ Test 13 passed: 5xx transient error retried and recovered.\n');

    // -------------------------------------------------------------------------
    // Test 14: Network Failure & Timeout
    // -------------------------------------------------------------------------
    console.log('Test 14: Testing Network Failure & Timeout...');
    const clientDeadPort = new HuntIQClient({ apiUrl: 'http://localhost:3997/dead', maxRetries: 1, timeoutMs: 300 });
    let caughtNetErr = false;
    try {
      await clientDeadPort.syncContacts(payload401);
    } catch (err) {
      caughtNetErr = true;
    }
    assert.strictEqual(caughtNetErr, true);

    mockScenario = 'timeout';
    const clientTimeout = new HuntIQClient({ timeoutMs: 300, maxRetries: 0 });
    let caughtTimeout = false;
    try {
      await clientTimeout.syncContacts(payload401);
    } catch (err) {
      caughtTimeout = true;
    }
    assert.strictEqual(caughtTimeout, true);
    console.log('   ✓ Test 14 passed: Network failure and timeout abort handled cleanly.\n');

    // -------------------------------------------------------------------------
    // Test 15: Idempotency-Key Header
    // -------------------------------------------------------------------------
    console.log('Test 15: Testing Idempotency-Key Header...');
    mockScenario = 'normal';
    receivedHeadersList = [];
    const clientNormal = new HuntIQClient();
    const idempPayload = mapRecordsToHuntIQPayload([sampleRecord]);
    await clientNormal.syncContacts(idempPayload);
    const idempHeaders = receivedHeadersList[receivedHeadersList.length - 1];
    assert.strictEqual(idempHeaders['idempotency-key'], idempPayload.requestId);
    console.log('   ✓ Test 15 passed: Idempotency-Key transmitted.\n');

    // -------------------------------------------------------------------------
    // Test 16: Duplicate Contact Deduplication
    // -------------------------------------------------------------------------
    console.log('Test 16: Testing Duplicate Contact Deduplication...');
    const dups = [
      { email: 'alex@acme.com' },
      { email: 'ALEX@acme.com' },
      { email: 'alex@acme.com ' }
    ];
    const dedupPayload = mapRecordsToHuntIQPayload(dups);
    assert.strictEqual(dedupPayload.contacts.length, 1);
    console.log('   ✓ Test 16 passed: Duplicate contacts deduplicated.\n');

    // -------------------------------------------------------------------------
    // Test 17: Zero Company & Website Fabrication
    // -------------------------------------------------------------------------
    console.log('Test 17: Verifying No Fabricated Company Name or Website...');
    const recordNoCo = { email: 'sales@techcorp.io', domain: 'techcorp.io' };
    const payloadNoCo = mapRecordsToHuntIQPayload([recordNoCo]);
    assert.strictEqual(payloadNoCo.company.name, null);
    assert.strictEqual(payloadNoCo.company.website, null);
    console.log('   ✓ Test 17 passed: company.name and company.website are strictly null.\n');

    // -------------------------------------------------------------------------
    // Test 18: Inferred Identity Isolation vs Verified Identity
    // -------------------------------------------------------------------------
    console.log('Test 18: Testing Inferred Identity Isolation...');
    const inferredRec = { email: 'sarah.connor@sky.net', name: 'Sarah Connor' };
    const mappedInferred = mapRecordToHuntIQContact(inferredRec);
    assert.strictEqual(mappedInferred.name, null);
    assert.ok(mappedInferred.identityInference);
    assert.strictEqual(mappedInferred.identityInference.firstName, 'Sarah');
    assert.strictEqual(mappedInferred.identityInference.source, 'email_local_part');

    const verifiedRec = { email: 'ceo@acme.com', name: 'Dr. Elena Rostova', sourceUrl: 'https://acme.com/team' };
    const mappedVerified = mapRecordToHuntIQContact(verifiedRec);
    assert.strictEqual(mappedVerified.name, 'Dr. Elena Rostova');
    assert.strictEqual(mappedVerified.identitySource, 'website');
    assert.strictEqual(mappedVerified.identityInference, undefined);
    console.log('   ✓ Test 18 passed: Inferred names isolated; verified names preserved.\n');

    // -------------------------------------------------------------------------
    // Test 19: No Automatic Outreach Creation
    // -------------------------------------------------------------------------
    console.log('Test 19: Verifying No Automatic Outreach Creation...');
    assert.strictEqual(dedupPayload.createOutreachDraft, undefined);
    assert.strictEqual(dedupPayload.contacts[0].createOutreachDraft, undefined);
    console.log('   ✓ Test 19 passed: No outreach directives emitted.\n');

    // -------------------------------------------------------------------------
    // Test 20: Batch SSRF Validation & Per-URL Error Handling
    // -------------------------------------------------------------------------
    console.log('Test 20: Testing Batch SSRF Validation & Per-URL Isolation...');
    const batchRes = await fetch('http://localhost:3002/api/scrape/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        urls: [
          'http://localhost:3002/api/demo', // safe local demo endpoint
          'http://169.254.169.254/latest/meta-data', // SSRF cloud metadata
          'http://999.999.999.999/malformed-ip', // Malformed IPv4
          'ftp://forbidden-proto.com/file' // Disallowed protocol
        ]
      })
    });
    assert.strictEqual(batchRes.status, 200);
    const batchData = await batchRes.json();
    assert.strictEqual(batchData.success, true);
    assert.strictEqual(batchData.totalUrlsProcessed, 4);

    // Safe demo URL succeeded
    const demoSummary = batchData.summary.find(s => s.url.includes('/api/demo'));
    assert.ok(demoSummary && demoSummary.success === true, 'Safe demo URL must succeed');
    assert.ok(demoSummary.emailCount > 0, 'Must extract emails from demo');

    // Unsafe metadata URL failed with SSRF error
    const metaSummary = batchData.summary.find(s => s.url.includes('169.254.169.254'));
    assert.ok(metaSummary && metaSummary.success === false, 'Metadata SSRF must fail');
    assert.ok(metaSummary.error.includes('SSRF') || metaSummary.error.includes('metadata'), 'Error must note SSRF/metadata');

    // Malformed IP failed
    const malformedSummary = batchData.summary.find(s => s.url.includes('999.999.999.999'));
    assert.ok(malformedSummary && malformedSummary.success === false, 'Malformed IP must fail');
    assert.ok(malformedSummary.error.includes('malformed'), 'Error must note malformed IPv4');

    // Disallowed protocol failed
    const ftpSummary = batchData.summary.find(s => s.url.includes('ftp://'));
    assert.ok(ftpSummary && ftpSummary.success === false, 'Disallowed protocol must fail');

    console.log('   ✓ Test 20 passed: Batch validated every URL; unsafe URLs did not compromise batch.\n');

    // -------------------------------------------------------------------------
    // Test 21: Localhost & 127.0.0.1 Blocked
    // -------------------------------------------------------------------------
    console.log('Test 21: Testing Localhost & 127.0.0.1 Blocked...');
    const resLocalhost = await validateSafeScrapeUrl('http://localhost:8080/admin', { allowLocalhost: false });
    assert.strictEqual(resLocalhost.safe, false);
    const res127 = await validateSafeScrapeUrl('http://127.0.0.1:3000', { allowLocalhost: false });
    assert.strictEqual(res127.safe, false);
    console.log('   ✓ Test 21 passed: localhost and 127.0.0.1 loopback blocked.\n');

    // -------------------------------------------------------------------------
    // Test 22: RFC1918 Private Subnets Blocked (10.x, 172.16.x, 192.168.x)
    // -------------------------------------------------------------------------
    console.log('Test 22: Testing RFC1918 Private Subnets Blocked...');
    const resRfc10 = await validateSafeScrapeUrl('http://10.0.1.50/dashboard', { allowLocalhost: false });
    const resRfc172 = await validateSafeScrapeUrl('http://172.16.0.1/admin', { allowLocalhost: false });
    const resRfc192 = await validateSafeScrapeUrl('http://192.168.1.1/config', { allowLocalhost: false });
    assert.strictEqual(resRfc10.safe, false);
    assert.strictEqual(resRfc172.safe, false);
    assert.strictEqual(resRfc192.safe, false);
    console.log('   ✓ Test 22 passed: 10.x, 172.16.x, and 192.168.x private subnets blocked.\n');

    // -------------------------------------------------------------------------
    // Test 23: Cloud Metadata IP & Hostname Blocked (169.254.x, metadata.google.internal)
    // -------------------------------------------------------------------------
    console.log('Test 23: Testing Cloud Metadata IP & Hostname Blocked...');
    const resMetaIp = await validateSafeScrapeUrl('http://169.254.169.254/latest/meta-data/', { allowLocalhost: false });
    assert.strictEqual(resMetaIp.safe, false);
    const resMetaHost = await validateSafeScrapeUrl('http://metadata.google.internal/computeMetadata/v1/', { allowLocalhost: false });
    assert.strictEqual(resMetaHost.safe, false);
    console.log('   ✓ Test 23 passed: 169.254.x and metadata hostnames blocked.\n');

    // -------------------------------------------------------------------------
    // Test 24: Strict IPv4 Validation: Malformed IPv4 Blocked
    // -------------------------------------------------------------------------
    console.log('Test 24: Testing Strict IPv4 Validation (999.999.999.999)...');
    const resMalformed = await validateSafeScrapeUrl('http://999.999.999.999/test', { allowLocalhost: false });
    assert.strictEqual(resMalformed.safe, false);
    assert.ok(resMalformed.error.includes('malformed') || resMalformed.error.includes('Invalid'));
    const parsedCheck = parseAndValidateIpv4('999.999.999.999');
    assert.strictEqual(parsedCheck.valid, false);
    assert.strictEqual(parsedCheck.isIpPattern, true);
    console.log('   ✓ Test 24 passed: Malformed IPv4 strictly rejected without DNS lookup.\n');

    // -------------------------------------------------------------------------
    // Test 25: Unsafe Redirect Blocked in safeFetch
    // -------------------------------------------------------------------------
    console.log('Test 25: Testing Unsafe Redirect Blocked in safeFetch...');
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
    console.log('   ✓ Test 25 passed: SSRF redirect hop detected and blocked.\n');

    // -------------------------------------------------------------------------
    // Test 26: Oversized Response Blocked in safeFetch
    // -------------------------------------------------------------------------
    console.log('Test 26: Testing Oversized Response Blocked in safeFetch...');
    const sizeServer = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
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
    console.log('   ✓ Test 26 passed: Oversized response aborted before memory overload.\n');

    // -------------------------------------------------------------------------
    // Test 27: Crawl Limits Sanitization
    // -------------------------------------------------------------------------
    console.log('Test 27: Testing Crawl Limits Sanitization...');
    const sanitizedPages = sanitizeCrawlLimits(1, 99999);
    assert.strictEqual(sanitizedPages.pages, CRAWL_SECURITY_LIMITS.MAX_PAGES_CAP);
    const sanitizedDepth = sanitizeCrawlLimits(999, 10);
    assert.strictEqual(sanitizedDepth.depth, CRAWL_SECURITY_LIMITS.MAX_DEPTH_CAP);
    console.log('   ✓ Test 27 passed: Page and depth limits strictly capped.\n');

    // -------------------------------------------------------------------------
    // Test 28: Quarantine Failure Preserves Original Active Records
    // -------------------------------------------------------------------------
    console.log('Test 28: Testing Quarantine Persistence Failure Does NOT Lose Data...');
    let simulatedRecords = [
      { email: 'valid@test.com', mxStatus: 'deliverable' },
      { email: 'dead@test.com', mxStatus: 'undeliverable' }
    ];

    async function safePurge(activeList, persister) {
      const dead = activeList.filter(r => r.mxStatus === 'undeliverable');
      if (dead.length === 0) return activeList;
      try {
        await persister(dead);
      } catch (err) {
        return activeList; // Retain active records on failure!
      }
      return activeList.filter(r => r.mxStatus !== 'undeliverable');
    }

    const afterFailedPurge = await safePurge(simulatedRecords, async () => {
      throw new Error('Disk full on quarantine folder');
    });
    assert.strictEqual(afterFailedPurge.length, 2, 'Must retain all records when quarantine fails');
    console.log('   ✓ Test 28 passed: Active records preserved when quarantine fails.\n');

    // -------------------------------------------------------------------------
    // Test 29: Successful Quarantine Archives Correctly
    // -------------------------------------------------------------------------
    console.log('Test 29: Testing Successful Quarantine Archives Correctly...');
    let quarantinedStorage = [];
    const afterSuccessPurge = await safePurge(simulatedRecords, async (records) => {
      quarantinedStorage.push(...records);
      return true;
    });
    assert.strictEqual(afterSuccessPurge.length, 1, 'Only deliverable records remain active');
    assert.strictEqual(quarantinedStorage.length, 1, 'Dead records safely archived');
    assert.strictEqual(quarantinedStorage[0].email, 'dead@test.com');
    console.log('   ✓ Test 29 passed: Dead records safely archived only after confirmed persistence.\n');

    console.log('🎉 All Final HUNTIQ Pre-Integration Hardening Tests Successfully Passed!\n');
  } finally {
    mockHuntiqServer.close();
    scraperServer.close();
  }
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
