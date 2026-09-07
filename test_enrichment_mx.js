const assert = require('assert');
const { verifyDomainMx, verifyEmailRecords } = require('./dist/utils/verifier');
const { 
  extractPhoneNumbersFromHtml, 
  extractSocialProfiles, 
  detectJobTitle, 
  inferNameFromEmail,
  extractEmailRecordsFromHtml 
} = require('./dist/utils/emailExtractor');

async function runTests() {
  console.log('🧪 Testing Option A: Live MX Deliverability Verification...');

  // 1. Test known live domain (cloudflare.com or google.com)
  const cfMx = await verifyDomainMx('cloudflare.com');
  console.log('   • cloudflare.com MX status:', cfMx.status, 'records:', cfMx.mxRecords.slice(0, 2));
  assert.strictEqual(cfMx.status, 'deliverable', 'cloudflare.com must be deliverable');
  assert.ok(cfMx.mxRecords.length > 0, 'cloudflare.com must have MX records');

  // 2. Test disposable domain
  const dispMx = await verifyDomainMx('mailinator.com');
  console.log('   • mailinator.com MX status:', dispMx.status);
  assert.strictEqual(dispMx.status, 'disposable', 'mailinator.com must be detected as disposable');

  // 3. Test non-existent domain
  const nonExistent = await verifyDomainMx('thishostnamedefinitelydoesnotexist991823.xyz');
  console.log('   • non-existent domain status:', nonExistent.status);
  assert.strictEqual(nonExistent.status, 'undeliverable', 'fake domain must be undeliverable');

  console.log('\n🧪 Testing Option B: Contact Enrichment...');

  // 4. Test Name inference from email
  const name1 = inferNameFromEmail('sarah.connor@sky.net');
  console.log('   • Inferred name from sarah.connor@sky.net:', name1);
  assert.strictEqual(name1, 'Sarah Connor');

  const name2 = inferNameFromEmail('marcus_aurelius_99@rome.org');
  console.log('   • Inferred name from marcus_aurelius_99@rome.org:', name2);
  assert.strictEqual(name2, 'Marcus Aurelius');

  // 5. Test Phone extraction
  const sampleHtml = `
    <div>
      <h3>Contact Us</h3>
      <p>Call our direct line: <a href="tel:+18005550199">+1 (800) 555-0199</a> or mobile (415) 890-1234.</p>
      <a href="https://www.linkedin.com/in/alex-smith-ceo">LinkedIn Profile</a>
      <p>Alex Smith is the Chief Executive Officer at Acme Ventures.</p>
      <p>Reach Alex at: alex.smith@acmeventures.com</p>
    </div>
  `;

  const phones = extractPhoneNumbersFromHtml(sampleHtml);
  console.log('   • Extracted phones:', phones);
  assert.ok(phones.length >= 1, 'Should find phone numbers');

  // 6. Test Social profile extraction
  const socials = extractSocialProfiles(sampleHtml);
  console.log('   • Extracted socials:', socials);
  assert.ok(socials.linkedin && socials.linkedin.includes('alex-smith-ceo'), 'Should find LinkedIn profile');

  // 7. Test Job title detection
  const title = detectJobTitle('Alex Smith is the Chief Executive Officer at Acme Ventures.');
  console.log('   • Detected job title:', title);
  assert.strictEqual(title, 'Chief Executive Officer');

  // 8. Test full extraction pipeline with enrichment
  const records = extractEmailRecordsFromHtml(sampleHtml, 'https://acmeventures.com/team', 'Acme Leadership');
  console.log('   • Enriched records:', records.map(r => ({
    email: r.email,
    name: r.name,
    jobTitle: r.jobTitle,
    phone: r.phone,
    linkedin: r.socials && r.socials.linkedin
  })));

  assert.strictEqual(records.length, 1);
  assert.strictEqual(records[0].name, 'Alex Smith');
  assert.strictEqual(records[0].jobTitle, 'Chief Executive Officer');
  assert.ok(records[0].phone);
  assert.ok(records[0].socials && records[0].socials.linkedin);

  // 9. Batch verification test
  const batchVerified = await verifyEmailRecords(records);
  console.log('   • Batch verification complete. mxStatus:', batchVerified[0].mxStatus);

  console.log('\n✅ All Option A (Deliverability) & Option B (Enrichment) tests passed successfully!\n');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
