const assert = require('assert');
const http = require('http');

async function runTests() {
  console.log('🧪 Starting HUNTIQ CRM Ingest Integration Tests...\n');

  // 1. Create a mock HUNTIQ server on port 3999 to verify incoming payload
  let receivedPayload = null;
  let receivedHeaders = null;

  const mockHuntiqServer = http.createServer((req, res) => {
    receivedHeaders = req.headers;
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      receivedPayload = JSON.parse(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        workspaceId: req.headers['x-workspace-id'],
        importedCount: receivedPayload.leads ? receivedPayload.leads.length : 0,
        outreachDraftsCreated: receivedPayload.createOutreachDraft ? receivedPayload.leads.length : 0,
        message: 'Leads ingested successfully into HUNTIQ CRM'
      }));
    });
  });

  await new Promise(resolve => mockHuntiqServer.listen(3999, resolve));
  console.log('   ✓ Mock HUNTIQ server listening on port 3999');

  // 2. Start EmailScraper Pro API server on port 3002
  const { startServer } = require('./dist/server/index');
  const scraperServer = startServer(3002);
  console.log('   ✓ EmailScraper Pro API server running on port 3002\n');

  try {
    // 3. Test Connection Ping (/api/sync/huntiq/test)
    console.log('1. Testing POST /api/sync/huntiq/test (Connection Ping)...');
    const pingRes = await fetch('http://localhost:3002/api/sync/huntiq/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        huntiqApiUrl: 'http://localhost:3999/api/v1/integrations/lead-ingest',
        workspaceId: 'ws-agency-007'
      })
    });
    const pingData = await pingRes.json();
    assert.strictEqual(pingData.success, true);
    assert.strictEqual(pingData.reachable, true);
    console.log('   ✓ HUNTIQ connection ping succeeded!\n');

    // 4. Test Lead Synchronization (/api/sync/huntiq)
    console.log('2. Testing POST /api/sync/huntiq (Ingest Payload Format A)...');
    const sampleRecords = [
      {
        email: 'elena.rostova@acme-demo.com',
        name: 'Dr. Elena Rostova',
        jobTitle: 'Chief Executive Officer',
        domain: 'acme-demo.com',
        phone: '+1 (555) 234-5678',
        sourceUrl: 'https://acme-demo.com/team',
        mxStatus: 'deliverable',
        socials: {
          linkedin: 'https://linkedin.com/in/elena-rostova',
          twitter: 'https://twitter.com/erostova'
        },
        contextSnippet: 'Elena Rostova leads global operations as Chief Executive Officer'
      },
      {
        email: 'marcus.vance@techcorp.io',
        domain: 'techcorp.io',
        mxStatus: 'deliverable'
      }
    ];

    const syncRes = await fetch('http://localhost:3002/api/sync/huntiq', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        records: sampleRecords,
        huntiqApiUrl: 'http://localhost:3999/api/v1/integrations/lead-ingest',
        workspaceId: 'ws-agency-007',
        apiKey: 'hnt_live_testkey123',
        createOutreachDraft: true
      })
    });

    const syncData = await syncRes.json();
    assert.strictEqual(syncData.success, true);
    assert.strictEqual(syncData.syncedCount, 2);
    console.log('   ✓ Sync endpoint responded successfully:', syncData.huntiqResponse.message);

    // 5. Verify payload received by HUNTIQ matches specification
    console.log('\n3. Verifying HUNTIQ Ingestion Payload against Specification:');
    assert.ok(receivedPayload, 'Payload must be received by HUNTIQ');
    assert.strictEqual(receivedPayload.source, 'EXTERNAL_EMAIL_SCRAPER');
    assert.strictEqual(receivedPayload.createOutreachDraft, true);
    assert.strictEqual(receivedHeaders['x-workspace-id'], 'ws-agency-007');
    assert.strictEqual(receivedHeaders['x-huntiq-api-key'], 'hnt_live_testkey123');

    const lead1 = receivedPayload.leads[0];
    console.log('   • Lead 1 Email:', lead1.email);
    console.log('   • Lead 1 Name:', lead1.name, `(${lead1.firstName} / ${lead1.lastName})`);
    console.log('   • Lead 1 Job Title:', lead1.jobTitle);
    console.log('   • Lead 1 Company:', lead1.companyName);
    console.log('   • Lead 1 Website:', lead1.website);
    console.log('   • Lead 1 Phone:', lead1.phone);
    console.log('   • Lead 1 MX Status:', lead1.mxStatus);
    console.log('   • Lead 1 Socials:', lead1.socials);
    console.log('   • Lead 1 Notes:', lead1.notes);

    assert.strictEqual(lead1.email, 'elena.rostova@acme-demo.com');
    assert.strictEqual(lead1.firstName, 'Dr.');
    assert.strictEqual(lead1.lastName, 'Elena Rostova');
    assert.strictEqual(lead1.jobTitle, 'Chief Executive Officer');
    assert.strictEqual(lead1.companyName, 'Acme-demo');
    assert.strictEqual(lead1.website, 'https://acme-demo.com');
    assert.strictEqual(lead1.phone, '+1 (555) 234-5678');
    assert.strictEqual(lead1.mxStatus, 'deliverable');
    assert.ok(lead1.socials && lead1.socials.linkedin);

    const lead2 = receivedPayload.leads[1];
    assert.strictEqual(lead2.email, 'marcus.vance@techcorp.io');
    assert.strictEqual(lead2.firstName, 'Marcus');
    assert.strictEqual(lead2.companyName, 'Techcorp');
    assert.strictEqual(lead2.website, 'https://techcorp.io');

    console.log('\n🎉 HUNTIQ Ingestion Integration & Parameter Mapping Fully Verified!\n');
  } finally {
    mockHuntiqServer.close();
    scraperServer.close();
  }
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
