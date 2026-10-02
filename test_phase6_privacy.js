const assert = require('assert');
const { startServer } = require('./dist/server/index.js');
const {
  maskEmail,
  sanitizeLogContent,
  sanitizeContextSnippet,
  suppressionManager,
  auditStore,
  getStandardComplianceNotice,
  isRestrictedCompliancePath,
  COMPLIANCE_DISCLAIMER,
  DataDeletionManager,
  hashSha256,
  hashMd5,
  extractEmailRecordsFromHtml
} = require('./dist/index.js');
const {
  createFolder,
  saveRecordsToFolder,
  getFolder
} = require('./dist/utils/folderStorage.js');

async function runPhase6PrivacyTests() {
  console.log('\n🔒 Starting Phase Six: Email Data Security & Privacy Test Suite...\n');

  /* ========================================================================= */
  /* Part 1: In-Memory / Component Privacy & Minimization Tests                */
  /* ========================================================================= */

  console.log('1. Testing Privacy-Aware Logger & Sensitive Data Masking...');
  // 1a. Email masking
  assert.strictEqual(maskEmail('john.doe@example.com'), 'j***e@example.com');
  assert.strictEqual(maskEmail('a@b.com'), '*@b.com');
  assert.strictEqual(maskEmail('contact@company.org'), 'c***t@company.org');

  // 1b. Log content sanitization
  const rawLog = 'User alex@test.com logged in with Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz and api_key=esp_live_secret12345';
  const cleanLog = sanitizeLogContent(rawLog);
  assert.ok(!cleanLog.includes('alex@test.com'), 'Raw email must not appear in logs');
  assert.ok(cleanLog.includes('a***x@test.com'), 'Masked email should appear in logs');
  assert.ok(!cleanLog.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'), 'JWT token must be redacted from logs');
  assert.ok(!cleanLog.includes('esp_live_secret12345'), 'API key must be redacted from logs');
  console.log('   ✓ Log masking and credential redaction verified.');

  console.log('2. Testing Context Snippet Sanitization & PII Redaction...');
  // 2a. Redact credit card numbers
  const snippetWithCC = 'Contact Alice at alice@corp.com or charge card 4532-1234-5678-9010 for inquiries.';
  const cleanCC = sanitizeContextSnippet(snippetWithCC);
  assert.ok(!cleanCC.includes('4532-1234-5678-9010'), 'Credit card must be redacted');
  assert.ok(cleanCC.includes('[REDACTED_CARD]'), 'Should contain redacted card marker');

  // 2b. Redact SSN
  const snippetWithSSN = 'Tax record ID: 123-45-6789 verified.';
  const cleanSSN = sanitizeContextSnippet(snippetWithSSN);
  assert.ok(!cleanSSN.includes('123-45-6789'), 'SSN must be redacted');
  assert.ok(cleanSSN.includes('[REDACTED_SSN]'), 'Should contain redacted SSN marker');

  // 2c. Redact inline passwords
  const snippetWithPass = 'Server configuration: password="SuperSecret123!" for database.';
  const cleanPass = sanitizeContextSnippet(snippetWithPass);
  assert.ok(!cleanPass.includes('SuperSecret123!'), 'Password must be redacted');
  assert.ok(cleanPass.includes('[REDACTED_SECRET]'), 'Should contain redacted secret marker');

  // 2d. Max length capping
  const longSnippet = 'A'.repeat(300);
  const capped = sanitizeContextSnippet(longSnippet, { maxChars: 50 });
  assert.ok(capped.length <= 53, 'Capped snippet length must not exceed bound');
  assert.ok(capped.endsWith('...'), 'Capped snippet should end with ellipsis');

  // 2e. Strip snippet completely if requested
  const stripped = sanitizeContextSnippet('Any snippet', { stripSnippet: true });
  assert.strictEqual(stripped, undefined, 'Snippet must be undefined when stripSnippet is true');
  console.log('   ✓ Context snippet sanitization, PII redaction, and length bounds verified.');

  console.log('3. Testing Provenance Metadata & Context Types on Extracted Records...');
  const sampleHtml = `
    <html>
      <body>
        <a href="mailto:direct@acme.com">Mail Us</a>
        <p>You can also reach info@acme.com for general questions.</p>
        <script>const meta = { email: "admin@acme.com" };</script>
      </body>
    </html>
  `;
  const records = extractEmailRecordsFromHtml(sampleHtml, 'https://acme.com/contact', 'Acme Contact');
  assert.ok(records.length >= 3, 'Should extract all three emails');
  const directRec = records.find(r => r.email === 'direct@acme.com');
  assert.ok(directRec, 'direct@acme.com must exist');
  assert.strictEqual(directRec.contextType, 'mailto', 'Direct link must have mailto contextType');
  assert.strictEqual(directRec.extractionMethod, 'http', 'Extraction method should be http');
  assert.strictEqual(directRec.sourceUrl, 'https://acme.com/contact');
  assert.ok(directRec.discoveredAt, 'Discovered timestamp must be present');

  const textRec = records.find(r => r.email === 'info@acme.com');
  assert.ok(textRec, 'info@acme.com must exist');
  assert.strictEqual(textRec.contextType, 'text', 'Text email must have text contextType');
  console.log('   ✓ Provenance metadata and context types verified.');

  console.log('4. Testing Legal Disclaimers & Restricted Scraping Paths...');
  const notice = getStandardComplianceNotice();
  assert.strictEqual(notice.proofOfMailboxExistence, false, 'Proof of mailbox existence must be false');
  assert.strictEqual(notice.outreachConsentConfirmed, false, 'Outreach consent must be false');
  assert.ok(notice.legalDisclaimer.includes('does NOT constitute proof'), 'Disclaimer text must be present');

  // Restricted path check
  assert.strictEqual(isRestrictedCompliancePath('https://target.com/wp-admin/settings.php').restricted, true);
  assert.strictEqual(isRestrictedCompliancePath('https://target.com/login').restricted, true);
  assert.strictEqual(isRestrictedCompliancePath('https://target.com/.git/config').restricted, true);
  assert.strictEqual(isRestrictedCompliancePath('https://target.com/about-us').restricted, false);
  console.log('   ✓ Compliance disclaimers and restricted path detection verified.');

  /* ========================================================================= */
  /* Part 2: HTTP Integration Tests (Port 3035)                                */
  /* ========================================================================= */

  const TEST_PORT = 3035;
  const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
  const server = startServer(TEST_PORT);
  await new Promise(r => setTimeout(r, 600));

  try {
    console.log('\n5. Setting Up Authenticated Test Sessions (Admin & Standard Users)...');
    // Admin session
    const adminAuthRes = await fetch(`${BASE_URL}/api/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'compliance_officer', role: 'admin' })
    });
    const adminAuth = await adminAuthRes.json();
    assert.strictEqual(adminAuthRes.status, 200);
    const adminToken = adminAuth.token;
    const adminUserId = adminAuth.user.id;

    // User 1 session
    const user1Res = await fetch(`${BASE_URL}/api/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'marketer_bob', role: 'user' })
    });
    const user1Auth = await user1Res.json();
    assert.strictEqual(user1Res.status, 200);
    const user1Token = user1Auth.token;
    const user1Id = user1Auth.user.id;

    // User 2 session
    const user2Res = await fetch(`${BASE_URL}/api/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'marketer_eve', role: 'user' })
    });
    const user2Auth = await user2Res.json();
    assert.strictEqual(user2Res.status, 200);
    const user2Token = user2Auth.token;
    const user2Id = user2Auth.user.id;
    console.log('   ✓ Authenticated sessions created.');

    console.log('6. Testing Suppression List API & Multi-Type Matching...');
    // Clear suppression manager first for clean run
    suppressionManager.clear();

    // 6a. Add single email suppression entry
    const addSuppRes = await fetch(`${BASE_URL}/api/privacy/suppression`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${user1Token}`
      },
      body: JSON.stringify({
        type: 'email',
        value: 'optout@example.com',
        reason: 'unsubscribe',
        note: 'User requested opt-out'
      })
    });
    assert.strictEqual(addSuppRes.status, 201);
    const addSuppData = await addSuppRes.json();
    assert.strictEqual(addSuppData.success, true);
    assert.strictEqual(addSuppData.entry.value, 'optout@example.com');
    const user1EntryId = addSuppData.entry.id;

    // 6b. Bulk add suppression entries (domain, sha256, md5)
    const competitorSha = hashSha256('ceo@competitor.com');
    const vipMd5 = hashMd5('vip@client.com');

    const bulkSuppRes = await fetch(`${BASE_URL}/api/privacy/suppression/bulk`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${user1Token}`
      },
      body: JSON.stringify({
        entries: [
          { type: 'domain', value: 'do-not-contact.com', reason: 'dnc' },
          { type: 'sha256', value: competitorSha, reason: 'legal' },
          { type: 'md5', value: vipMd5, reason: 'complaint' }
        ]
      })
    });
    assert.strictEqual(bulkSuppRes.status, 200);
    const bulkSuppData = await bulkSuppRes.json();
    assert.strictEqual(bulkSuppData.success, true);
    assert.strictEqual(bulkSuppData.addedCount, 3);

    // 6c. Verify suppression checks via API
    // Check direct email
    const check1 = await (await fetch(`${BASE_URL}/api/privacy/suppression/check/optout@example.com`, {
      headers: { 'Authorization': `Bearer ${user1Token}` }
    })).json();
    assert.strictEqual(check1.isSuppressed, true);
    assert.strictEqual(check1.matchedType, 'email');

    // Check domain suppression
    const check2 = await (await fetch(`${BASE_URL}/api/privacy/suppression/check/john@do-not-contact.com`, {
      headers: { 'Authorization': `Bearer ${user1Token}` }
    })).json();
    assert.strictEqual(check2.isSuppressed, true);
    assert.strictEqual(check2.matchedType, 'domain');

    // Check SHA-256 hash match
    const check3 = await (await fetch(`${BASE_URL}/api/privacy/suppression/check/ceo@competitor.com`, {
      headers: { 'Authorization': `Bearer ${user1Token}` }
    })).json();
    assert.strictEqual(check3.isSuppressed, true);
    assert.strictEqual(check3.matchedType, 'sha256');

    // Check MD5 hash match
    const check4 = await (await fetch(`${BASE_URL}/api/privacy/suppression/check/vip@client.com`, {
      headers: { 'Authorization': `Bearer ${user1Token}` }
    })).json();
    assert.strictEqual(check4.isSuppressed, true);
    assert.strictEqual(check4.matchedType, 'md5');

    // Check non-suppressed email
    const check5 = await (await fetch(`${BASE_URL}/api/privacy/suppression/check/allowed@example.com`, {
      headers: { 'Authorization': `Bearer ${user1Token}` }
    })).json();
    assert.strictEqual(check5.isSuppressed, false);

    // 6d. Test IDOR protection on suppression deletion
    // User 2 attempts to delete User 1's entry -> 403 Forbidden
    const idorDelRes = await fetch(`${BASE_URL}/api/privacy/suppression/${user1EntryId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${user2Token}` }
    });
    assert.strictEqual(idorDelRes.status, 403, 'User 2 must not be able to delete User 1 suppression entry');

    // User 1 deletes own entry -> 200 Success
    const ownDelRes = await fetch(`${BASE_URL}/api/privacy/suppression/${user1EntryId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${user1Token}` }
    });
    assert.strictEqual(ownDelRes.status, 200);
    console.log('   ✓ Suppression lists (email, domain, sha256, md5) & IDOR access controls verified.');

    console.log('7. Testing Export Controls, Suppression Filtering & Audit Trail Logging...');
    auditStore.clear();

    // 7a. Perform export with filterSuppressed: true
    const testRecords = [
      { email: 'allowed1@example.com', name: 'Allowed One' },
      { email: 'john@do-not-contact.com', name: 'Suppressed Domain User' },
      { email: 'allowed2@example.com', name: 'Allowed Two' }
    ];

    const exportRes = await fetch(`${BASE_URL}/api/export`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${user1Token}`
      },
      body: JSON.stringify({
        records: testRecords,
        format: 'csv',
        filterSuppressed: true
      })
    });
    assert.strictEqual(exportRes.status, 200);
    assert.strictEqual(exportRes.headers.get('X-Export-Count'), '2', 'Must filter out 1 suppressed record');
    assert.ok(exportRes.headers.get('X-Compliance-Notice'), 'Must include X-Compliance-Notice header');
    const csvContent = await exportRes.text();
    assert.ok(!csvContent.includes('john@do-not-contact.com'), 'Suppressed email must not appear in exported CSV');
    assert.ok(csvContent.includes('allowed1@example.com'), 'Allowed email 1 must be present');
    assert.ok(csvContent.includes('allowed2@example.com'), 'Allowed email 2 must be present');

    // 7b. Verify Audit Trail Logging
    // User 1 cannot access global audit logs (requires privacy:audit:read / admin)
    const forbiddenAuditRes = await fetch(`${BASE_URL}/api/privacy/audit-logs`, {
      headers: { 'Authorization': `Bearer ${user1Token}` }
    });
    assert.strictEqual(forbiddenAuditRes.status, 403, 'Non-admin user cannot read audit logs');

    // Admin can access audit logs
    const adminAuditRes = await fetch(`${BASE_URL}/api/privacy/audit-logs`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.strictEqual(adminAuditRes.status, 200);
    const auditData = await adminAuditRes.json();
    assert.strictEqual(auditData.success, true);
    assert.ok(auditData.logs.length >= 1, 'Audit log entry must have been created');
    const logEntry = auditData.logs[0];
    assert.strictEqual(logEntry.userId, user1Id);
    assert.strictEqual(logEntry.format, 'csv');
    assert.strictEqual(logEntry.recordCount, 2);
    assert.strictEqual(logEntry.filterSuppressed, true);
    assert.ok(logEntry.clientIp, 'Client IP must be recorded');
    console.log('   ✓ Export suppression filtering, headers, and immutable audit trail verified.');

    console.log('8. Testing Compliance Disclaimers on Verification Endpoints...');
    // 8a. /api/verify/mx compliance notice
    const verifyMxRes = await fetch(`${BASE_URL}/api/verify/mx`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${user1Token}`
      },
      body: JSON.stringify({
        emails: ['compliance-test@gmail.com']
      })
    });
    assert.strictEqual(verifyMxRes.status, 200);
    const verifyMxData = await verifyMxRes.json();
    assert.ok(verifyMxData.complianceNotice, 'Compliance notice must be present in verify/mx output');
    assert.strictEqual(verifyMxData.complianceNotice.proofOfMailboxExistence, false);
    assert.strictEqual(verifyMxData.complianceNotice.outreachConsentConfirmed, false);

    // 8b. /api/validator/bulk compliance notice
    const bulkValRes = await fetch(`${BASE_URL}/api/validator/bulk`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${user1Token}`
      },
      body: JSON.stringify({
        emails: ['bulk-test@example.com']
      })
    });
    assert.strictEqual(bulkValRes.status, 200);
    const bulkValData = await bulkValRes.json();
    assert.ok(bulkValData.complianceNotice, 'Compliance notice must be present in validator/bulk output');
    assert.strictEqual(bulkValData.complianceNotice.proofOfMailboxExistence, false);
    console.log('   ✓ Compliance disclaimers attached to deliverability verification endpoints.');

    console.log('9. Testing Privacy Configuration API...');
    // 9a. GET config
    const getCfgRes = await fetch(`${BASE_URL}/api/privacy/config`, {
      headers: { 'Authorization': `Bearer ${user1Token}` }
    });
    assert.strictEqual(getCfgRes.status, 200);
    const cfgData = await getCfgRes.json();
    assert.strictEqual(cfgData.success, true);
    assert.strictEqual(cfgData.config.maskEmailsInLogs, true);

    // 9b. Non-admin cannot update privacy config
    const forbiddenPutCfg = await fetch(`${BASE_URL}/api/privacy/config`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${user1Token}`
      },
      body: JSON.stringify({ retentionDays: 60 })
    });
    assert.strictEqual(forbiddenPutCfg.status, 403);

    // 9c. Admin can update privacy config
    const adminPutCfg = await fetch(`${BASE_URL}/api/privacy/config`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({ retentionDays: 45, contextSnippetMaxChars: 120 })
    });
    assert.strictEqual(adminPutCfg.status, 200);
    const updatedCfg = await adminPutCfg.json();
    assert.strictEqual(updatedCfg.config.retentionDays, 45);
    assert.strictEqual(updatedCfg.config.contextSnippetMaxChars, 120);
    console.log('   ✓ Privacy configuration reading, updating, and role enforcement verified.');

    console.log('10. Testing Right-to-be-Forgotten & Data Deletion Workflows...');
    // 10a. Seed a test folder with records
    const testFolder = createFolder('Privacy Test Folder');
    saveRecordsToFolder(testFolder.id, [
      { email: 'delete-me@privacy.org', sourceUrl: 'https://example.com' },
      { email: 'keep-me@privacy.org', sourceUrl: 'https://example.com' }
    ]);

    // 10b. Delete records matching an email (Right to be Forgotten)
    const delRecordRes = await fetch(`${BASE_URL}/api/privacy/records/email/delete-me@privacy.org`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${user1Token}` }
    });
    assert.strictEqual(delRecordRes.status, 200);
    const delRecordData = await delRecordRes.json();
    assert.strictEqual(delRecordData.success, true);
    assert.ok(delRecordData.deletedRecordsCount >= 1, 'Should report at least 1 deleted record');

    const updatedFolder = getFolder(testFolder.id);
    assert.ok(!updatedFolder.records.some(r => r.email === 'delete-me@privacy.org'), 'delete-me@privacy.org must be gone');
    assert.ok(updatedFolder.records.some(r => r.email === 'keep-me@privacy.org'), 'keep-me@privacy.org must remain');

    // 10c. Account Purge
    const purgeRes = await fetch(`${BASE_URL}/api/privacy/account`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${user1Token}` }
    });
    assert.strictEqual(purgeRes.status, 200);
    const purgeData = await purgeRes.json();
    assert.strictEqual(purgeData.success, true);
    assert.ok(purgeData.details.includes('Purged'), 'Account purge details must confirm operation');
    console.log('   ✓ Right-to-be-forgotten record deletion & full account data purge verified.');

    console.log('\n🎉 ALL PHASE SIX EMAIL DATA SECURITY & PRIVACY TESTS PASSED (10/10)!\n');
  } finally {
    server.close();
  }
}

if (require.main === module) {
  runPhase6PrivacyTests().catch(err => {
    console.error('\n❌ Phase 6 Privacy Test Suite Failed:', err);
    process.exit(1);
  });
}

module.exports = { runPhase6PrivacyTests };
