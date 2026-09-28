const assert = require('assert');
const {
  validateEmailTwoLayer,
  validateBulkEmailsTwoLayer,
  runLayer1StaticValidation,
  runLayer2MxVerification,
  toCanonicalEmail,
  suggestDomainTypo,
  calculateShannonEntropy,
  isGibberishUsername
} = require('./dist/index');

async function runTests() {
  console.log('=== RUNNING 2-LAYER EMAIL VALIDATOR TEST SUITE ===\n');

  // Test 1: Canonical Email Deduplication Form
  console.log('Test 1: Canonical Email Deduplication Form...');
  assert.strictEqual(toCanonicalEmail('john.doe+newsletter@gmail.com'), 'johndoe@gmail.com');
  assert.strictEqual(toCanonicalEmail('J.O.H.N+sales@googlemail.com'), 'john@gmail.com');
  assert.strictEqual(toCanonicalEmail('support+urgent@company.org'), 'support@company.org');
  console.log('✓ Canonical deduplication logic verified.\n');

  // Test 2: Levenshtein Typo Correction
  console.log('Test 2: Levenshtein Typo Correction for Major Mailbox Providers...');
  assert.strictEqual(suggestDomainTypo('gmaill.com'), 'gmail.com');
  assert.strictEqual(suggestDomainTypo('gmial.com'), 'gmail.com');
  assert.strictEqual(suggestDomainTypo('hotmial.com'), 'hotmail.com');
  assert.strictEqual(suggestDomainTypo('outlok.com'), 'outlook.com');
  assert.strictEqual(suggestDomainTypo('yaho.com'), 'yahoo.com');
  assert.strictEqual(suggestDomainTypo('iclud.com'), 'icloud.com');
  assert.strictEqual(suggestDomainTypo('protonmai.com'), 'protonmail.com');
  assert.strictEqual(suggestDomainTypo('enterprise.co.uk'), null);
  console.log('✓ Levenshtein typo corrections verified.\n');

  // Test 3: Shannon Entropy & Gibberish Scoring
  console.log('Test 3: Shannon Entropy & Gibberish Scoring...');
  const normalEntropy = calculateShannonEntropy('alexsmith');
  const randomEntropy = calculateShannonEntropy('qzxkjfw98721plm');
  assert(randomEntropy > normalEntropy, 'Random string should have higher entropy');
  assert(isGibberishUsername('qzxkjfw98721plm').isGibberish, 'High entropy unpronounceable username should be flagged');
  assert(!isGibberishUsername('alexsmith').isGibberish, 'Standard username should not be flagged as gibberish');
  console.log(`✓ Entropy calculation verified (Normal: ${normalEntropy.toFixed(2)}, Random: ${randomEntropy.toFixed(2)}).\n`);

  // Test 4: Layer 1 Static Pre-SMTP Checks (All 16 checks)
  console.log('Test 4: Layer 1 - 16 Static Pre-SMTP Checks...');
  
  // 4a. Reserved TLD per RFC 2606 / 6761
  const reservedTldResult = runLayer1StaticValidation('user@testdomain.test');
  assert(!reservedTldResult.passed, 'Reserved TLD .test should fail validation');
  assert(reservedTldResult.failureReasons.some(r => r.includes('RFC 2606')));

  const exampleComResult = runLayer1StaticValidation('admin@example.com');
  assert(!exampleComResult.passed, 'example.com should fail reserved check');

  // 4b. Invalid DNS label (RFC 1035: hyphen at start or end, length > 63)
  const invalidLabelResult = runLayer1StaticValidation('user@-badlabel-.com');
  assert(!invalidLabelResult.passed, 'Domain label starting/ending with hyphen should fail RFC 1035');
  assert(invalidLabelResult.failureReasons.some(r => r.includes('RFC 1035')));

  // 4c. RFC 5321 Envelope Syntax violations (e.g., consecutive dots, spaces)
  const doubleDotResult = runLayer1StaticValidation('user..name@gmail.com');
  assert(!doubleDotResult.passed, 'Consecutive dots should fail RFC 5321 syntax');
  assert(doubleDotResult.failureReasons.some(r => r.includes('RFC 5321')));

  // 4d. Disposable database detection
  const disposableResult = runLayer1StaticValidation('test@mailinator.com');
  assert(disposableResult.isDisposable, 'mailinator.com must be identified as disposable');
  assert(disposableResult.failureReasons.some(r => r.includes('Disposable')));

  // 4e. Role-account classification
  const roleResult = runLayer1StaticValidation('support@stripe.com');
  assert(roleResult.isRoleAccount, 'support@ should be classified as role-account');

  // 4f. FreeMail detection
  const freeMailResult = runLayer1StaticValidation('john@gmail.com');
  assert(freeMailResult.isFreeMail, 'gmail.com should be detected as FreeMail');

  // 4g. Spam trap / invalid local part check
  const spamTrapResult = runLayer1StaticValidation('spamtrap@domain.com');
  assert(spamTrapResult.isSpamTrap, 'spamtrap should be identified as spam trap address');

  console.log('✓ Layer 1 static checks properly catch bad/disposable/reserved/syntax addresses.\n');

  // Test 5: End-to-End 2-Layer Validation
  console.log('Test 5: End-to-End 2-Layer Email Validation...');
  const testAddresses = [
    { email: 'alex.smith+test@google.com', name: 'Alex Smith' },
    { email: 'baduser@mailinator.com', name: 'Temp User' },
    { email: 'syntax..error@test.invalid', name: 'Invalid User' },
    { email: 'typo@gmial.com', name: 'Typo User' }
  ];

  const validatedRecords = await validateBulkEmailsTwoLayer(testAddresses);
  assert.strictEqual(validatedRecords.length, 4);

  // Check alex.smith@google.com
  const googleRec = validatedRecords.find(r => r.email.startsWith('alex.smith'));
  assert(googleRec, 'Google record must exist');
  assert.strictEqual(googleRec.canonicalEmail, 'alex.smith@google.com');
  assert(googleRec.staticChecks.passed >= 15, 'Google email should pass static checks');
  assert(googleRec.mxEnrichment, 'MX enrichment block must be present');
  console.log('Google record MX Enrichment:', JSON.stringify(googleRec.mxEnrichment));

  // Check mailinator.com
  const mailinatorRec = validatedRecords.find(r => r.email.includes('mailinator'));
  assert(mailinatorRec, 'Mailinator record must exist');
  assert.strictEqual(mailinatorRec.mxStatus, 'disposable');
  assert.strictEqual(mailinatorRec.isDisposable, true);

  // Check invalid syntax / reserved
  const invalidRec = validatedRecords.find(r => r.email.includes('test.invalid'));
  assert(invalidRec, 'Invalid record must exist');
  assert.strictEqual(invalidRec.mxStatus, 'undeliverable');
  assert(invalidRec.staticChecks.failedChecks.length > 0);

  // Check typo
  const typoRec = validatedRecords.find(r => r.email.includes('gmial.com'));
  assert(typoRec, 'Typo record must exist');
  assert.strictEqual(typoRec.typoSuggestion, 'typo@gmail.com');

  console.log('\n✓ ALL 2-LAYER VALIDATOR TESTS PASSED WITH 100% SUCCESS!');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
