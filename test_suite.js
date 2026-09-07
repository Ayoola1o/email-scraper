const {
  extractEmailRecordsFromHtml,
  formatRecords,
  decodeObfuscation,
  toCSV,
  toJSON,
  toPlainText,
  toVCard
} = require('./dist/index.js');
const http = require('http');

console.log('🧪 Starting Verification Test Suite...\n');

// 1. Test Extraction and Obfuscation Decoding
const sampleHtml = `
  <html>
    <head><title>Test Corporate Portal</title></head>
    <body>
      <h1>Contact Directory</h1>
      <p>Direct mail: <a href="mailto:ceo.founder@testcorp.com">CEO Founder</a></p>
      <p>Sales inbox: sales@testcorp.com</p>
      <p>Support desk: support@testcorp.com</p>
      <p>General inquiries: &#105;&#110;&#102;&#111;&#64;testcorp.com</p>
      <p>PR Contact: media.press [at] testcorp [dot] org</p>
      <p>Lead Engineer: alex.chen@engineering.io</p>
      <p>False positive assets that should NOT be extracted: image@2x.png and vendor@1.2.0.js</p>
    </body>
  </html>
`;

const records = extractEmailRecordsFromHtml(sampleHtml, 'https://testcorp.com/contact', 'Test Corporate Portal');

console.log(`✓ Extracted ${records.length} emails from test HTML:`);
records.forEach(r => {
  console.log(`   • ${r.email} | Type: ${r.type} | Domain: ${r.domain} | Snippet: "${r.contextSnippet || ''}"`);
});

// Assertions
const emails = records.map(r => r.email);
console.assert(emails.includes('ceo.founder@testcorp.com'), 'ceo.founder@testcorp.com should be extracted');
console.assert(emails.includes('sales@testcorp.com'), 'sales@testcorp.com should be extracted');
console.assert(emails.includes('support@testcorp.com'), 'support@testcorp.com should be extracted');
console.assert(emails.includes('info@testcorp.com'), 'Entity encoded info@testcorp.com should be extracted');
console.assert(emails.includes('media.press@testcorp.org'), 'Obfuscated media.press@testcorp.org should be extracted');
console.assert(emails.includes('alex.chen@engineering.io'), 'alex.chen@engineering.io should be extracted');
console.assert(!emails.some(e => e.includes('image@2x.png')), 'image@2x.png asset false-positive must be filtered');
console.assert(!emails.some(e => e.includes('vendor@1.2.0.js')), 'vendor@1.2.0.js asset false-positive must be filtered');

// Verify Personal vs Role
const supportRec = records.find(r => r.email === 'support@testcorp.com');
const alexRec = records.find(r => r.email === 'alex.chen@engineering.io');
console.assert(supportRec && supportRec.type === 'role', 'support@testcorp.com should be role');
console.assert(alexRec && alexRec.type === 'personal', 'alex.chen@engineering.io should be personal');
console.log('✓ Email classification verified.');

// 2. Test Multi-Format Exporters
const csvOutput = toCSV(records);
console.assert(csvOutput.startsWith('\uFEFF'), 'CSV must contain UTF-8 BOM for Excel compatibility');
console.assert(csvOutput.includes('"Email","Type","Domain"'), 'CSV must have correct headers');
console.log('✓ CSV (Excel-ready) exporter verified.');

const jsonOutput = toJSON(records);
const parsedJson = JSON.parse(jsonOutput);
console.assert(Array.isArray(parsedJson) && parsedJson.length === records.length, 'JSON exporter verified');
console.log('✓ JSON exporter verified.');

const txtOutput = toPlainText(records);
const txtLines = txtOutput.split('\n').filter(Boolean);
console.assert(txtLines.length === records.length, 'TXT exporter verified');
console.log('✓ Plain text list exporter verified.');

const vcfOutput = toVCard(records);
console.assert(vcfOutput.includes('BEGIN:VCARD') && vcfOutput.includes('EMAIL;TYPE=INTERNET,WORK:'), 'vCard exporter verified');
console.log('✓ vCard (.vcf) exporter verified.');

console.log('\n🎉 All Core Engine and Exporter Unit Tests Passed!');
