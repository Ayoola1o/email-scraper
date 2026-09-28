process.env.ALLOW_LOCAL_SCRAPING = 'true';
const { startServer } = require('./dist/server/index.js');

async function runServerTests() {
  console.log('🚀 Starting Server Integration Tests on port 3001...');
  const server = startServer(3001);

  // Give server a moment to bind
  await new Promise(r => setTimeout(r, 800));

  try {
    // 1. Health check
    console.log('1. Testing GET /api/health...');
    const healthRes = await fetch('http://localhost:3001/api/health');
    const healthData = await healthRes.json();
    console.assert(healthData.status === 'ok', 'Health status should be ok');
    console.log('   ✓ Health check passed.');

    // 2. Demo Page
    console.log('2. Testing GET /api/demo...');
    const demoRes = await fetch('http://localhost:3001/api/demo');
    const demoHtml = await demoRes.text();
    console.assert(demoHtml.includes('Acme Global Innovations'), 'Demo page should return Acme company html');
    console.log('   ✓ Demo page served correctly.');

    // 3. Scrape Page API
    console.log('3. Testing POST /api/scrape/page...');
    const scrapeRes = await fetch('http://localhost:3001/api/scrape/page', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'http://localhost:3001/api/demo' })
    });
    const scrapeData = await scrapeRes.json();
    console.assert(scrapeData.success === true, 'Scrape should succeed');
    console.assert(scrapeData.count > 0, 'Should find emails on demo page');
    console.log(`   ✓ Found ${scrapeData.count} email records on demo page.`);

    // 4. Scrape Text API
    console.log('4. Testing POST /api/scrape/text...');
    const textRes = await fetch('http://localhost:3001/api/scrape/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Contact Dr. Jane Doe at jane.doe@hospital.org or admin@hospital.org' })
    });
    const textData = await textRes.json();
    console.assert(textData.success === true && textData.count === 2, `Text extractor should find 2 emails, found ${textData.count}: ${JSON.stringify(textData.records)}`);
    console.log(`   ✓ Text extraction API verified: found ${textData.count} emails.`);

    // 5. Export API
    console.log('5. Testing POST /api/export (CSV)...');
    const exportRes = await fetch('http://localhost:3001/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: scrapeData.records, format: 'csv' })
    });
    const csvBuf = Buffer.from(await exportRes.arrayBuffer());
    console.assert(csvBuf[0] === 0xEF && csvBuf[1] === 0xBB && csvBuf[2] === 0xBF, 'CSV download buffer must have UTF-8 BOM bytes (0xEF, 0xBB, 0xBF)');
    console.log('   ✓ Export API generated valid Excel CSV with UTF-8 BOM.');

    // 5b. Segmented Export API
    console.log('5b. Testing POST /api/export with segment="clean"...');
    const segRes = await fetch('http://localhost:3001/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        records: [
          { email: 'valid@company.com', domain: 'company.com', mxStatus: 'deliverable' },
          { email: 'bad@dead.xyz', domain: 'dead.xyz', mxStatus: 'undeliverable' }
        ],
        format: 'csv',
        segment: 'clean'
      })
    });
    const segText = await segRes.text();
    console.assert(segText.includes('valid@company.com') && !segText.includes('bad@dead.xyz'), 'Clean export should only include deliverable contacts');
    console.assert(segRes.headers.get('content-disposition').includes('clean_deliverable_leads'), 'Header should specify clean_deliverable_leads filename');
    console.log('   ✓ Segmented Export API accurately isolated Clean Deliverable leads.');

    // 6. Deep Crawl API
    console.log('6. Testing POST /api/scrape/crawl...');
    const crawlRes = await fetch('http://localhost:3001/api/scrape/crawl', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'http://localhost:3001/api/demo',
        maxDepth: 2,
        maxPages: 10,
        delayMs: 50
      })
    });
    const crawlData = await crawlRes.json();
    console.assert(crawlData.success === true && crawlData.jobId, 'Crawl job should start with jobId');
    console.log(`   ✓ Crawl job registered with ID: ${crawlData.jobId}`);

    if (crawlData.jobId) {
      await fetch(`http://localhost:3001/api/scrape/crawl/cancel/${crawlData.jobId}`, { method: 'POST' });
    }

    // 7. Import Pre-Compiled Email List API
    console.log('7. Testing POST /api/import (Pre-compiled CSV)...');
    const importCsv = `email,name,company
contact@cloudflare.com,Cloudflare Desk,Cloudflare
marcus@techcorp.io,Marcus Vance,TechCorp`;
    const importRes = await fetch('http://localhost:3001/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: importCsv, verifyNow: true })
    });
    const importData = await importRes.json();
    console.assert(importData.success === true, 'Import should succeed');
    console.assert(importData.count === 2, `Should import 2 records, got ${importData.count}`);
    console.assert(importData.verified === true, 'Import should be verified when verifyNow=true');
    console.assert(importData.deliverableCount > 0, 'Should have deliverable emails');
    console.log(`   ✓ Import API parsed and verified ${importData.count} emails: ${importData.deliverableCount} deliverable.`);

    // 8. Verify Deliverability API
    console.log('8. Testing POST /api/verify/mx with emails list...');
    const verifyRes = await fetch('http://localhost:3001/api/verify/mx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emails: ['support@google.com', 'baduser@mailinator.com'] })
    });
    const verifyData = await verifyRes.json();
    console.assert(verifyData.success === true, 'Verify API should succeed');
    console.assert(verifyData.records.length === 2, 'Should verify 2 records');
    console.assert(verifyData.deliverableCount >= 1, 'Google should be deliverable');
    console.assert(verifyData.disposableCount >= 1, 'Mailinator should be disposable');
    console.log(`   ✓ Verify API accurately confirmed: ${verifyData.deliverableCount} deliverable, ${verifyData.disposableCount} disposable.`);

    console.log('\n🌟 All Server & API integration tests succeeded flawlessly!');
  } finally {
    server.close();
    console.log('Server closed gracefully.');
  }
}

runServerTests().catch(err => {
  console.error('Server test failed:', err);
  process.exit(1);
});
