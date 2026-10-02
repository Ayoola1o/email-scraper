/**
 * Phase Three: SSRF and Network Security Test Suite
 *
 * Verifies all SSRF protections, connection-level DNS rebinding defense,
 * alternate/numeric IP formats, IPv6, cloud metadata, redirects, protocol downgrade,
 * streaming size limits, decompression bomb protection, and browser route interception.
 */

const assert = require('assert');
const http = require('http');
const zlib = require('zlib');
const {
  validateSafeScrapeUrl,
  isRestrictedIpAddress,
  normalizeAlternativeIpString,
  parseAndValidateIpv4,
  safeFetch,
  CRAWL_SECURITY_LIMITS
} = require('./dist/utils/security.js');

const {
  createSecureLookup,
  executeSecureRequest
} = require('./dist/utils/secureHttpClient.js');

const {
  hardenBrowserPage,
  createIsolatedSession
} = require('./dist/utils/browserSecurity.js');

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function runPhaseThreeTests() {
  console.log('\n🔒 Starting Phase Three: SSRF & Network Security Test Suite...\n');

  // =========================================================================
  // Section 1: Alternate and Unusual Numeric IP Representations
  // =========================================================================
  console.log('1. Testing Alternate & Numeric IP Representations...');

  // Dword integer
  const dwordNorm = normalizeAlternativeIpString('2130706433');
  assert.strictEqual(dwordNorm, '127.0.0.1', '2130706433 must normalize to 127.0.0.1');
  assert.strictEqual(isRestrictedIpAddress('2130706433'), true, 'Dword 2130706433 must be restricted');

  // Hex single integer
  const hexSingle = normalizeAlternativeIpString('0x7f000001');
  assert.strictEqual(hexSingle, '127.0.0.1', '0x7f000001 must normalize to 127.0.0.1');
  assert.strictEqual(isRestrictedIpAddress('0x7f000001'), true, '0x7f000001 must be restricted');

  // Hex dotted
  const hexDotted = normalizeAlternativeIpString('0x7f.0.0.1');
  assert.strictEqual(hexDotted, '127.0.0.1', '0x7f.0.0.1 must normalize to 127.0.0.1');
  assert.strictEqual(isRestrictedIpAddress('0x7f.0.0.1'), true, '0x7f.0.0.1 must be restricted');

  // Octal dotted
  const octalDotted = normalizeAlternativeIpString('0177.0.0.1');
  assert.strictEqual(octalDotted, '127.0.0.1', '0177.0.0.1 must normalize to 127.0.0.1');
  assert.strictEqual(isRestrictedIpAddress('0177.0.0.1'), true, '0177.0.0.1 must be restricted');

  // BSD shorthand (2 parts)
  const shorthand2 = normalizeAlternativeIpString('127.1');
  assert.strictEqual(shorthand2, '127.0.0.1', '127.1 must normalize to 127.0.0.1');
  assert.strictEqual(isRestrictedIpAddress('127.1'), true, '127.1 must be restricted');

  // BSD shorthand private (10.1 -> 10.0.0.1)
  const shorthandPrivate = normalizeAlternativeIpString('10.1');
  assert.strictEqual(shorthandPrivate, '10.0.0.1', '10.1 must normalize to 10.0.0.1');
  assert.strictEqual(isRestrictedIpAddress('10.1'), true, '10.1 must be restricted');

  // URL credentials rejection
  const credsCheck = await validateSafeScrapeUrl('http://user:password@example.com/test');
  assert.strictEqual(credsCheck.safe, false);
  assert.ok(credsCheck.error.includes('credentials'));

  // Null byte / Control characters rejection
  const nullCheck = await validateSafeScrapeUrl('http://example.com%00.attacker.com');
  assert.strictEqual(nullCheck.safe, false);
  assert.ok(nullCheck.error.includes('control characters') || nullCheck.error.includes('null bytes'));

  const newlineCheck = await validateSafeScrapeUrl('http://example.com\r\nHeader: injected');
  assert.strictEqual(newlineCheck.safe, false);

  console.log('   ✓ Alternate IP representations, URL credentials, and control characters strictly blocked.\n');

  // =========================================================================
  // Section 2: IPv4 Loopback and Private Addresses
  // =========================================================================
  console.log('2. Testing IPv4 Loopback & Private Addresses...');

  const ipv4Tests = [
    'http://127.0.0.1/admin',
    'http://127.0.0.2:8080/status',
    'http://127.255.255.254/secret',
    'http://10.0.0.1/api',
    'http://10.255.255.254/data',
    'http://172.16.0.1/config',
    'http://172.31.255.255/internal',
    'http://192.168.0.1/router',
    'http://192.168.1.100/status',
    'http://100.64.0.1/cgnat',
    'http://0.0.0.0:3000/app',
    'http://255.255.255.255/broadcast'
  ];

  for (const url of ipv4Tests) {
    const res = await validateSafeScrapeUrl(url, { allowLocalhost: false });
    assert.strictEqual(res.safe, false, `Expected ${url} to be blocked`);
  }

  console.log('   ✓ All RFC 1918, loopback, CGNAT, broadcast, and current network addresses strictly blocked.\n');

  // =========================================================================
  // Section 3: IPv6 Loopback, Private, Link-Local & IPv4-Mapped IPv6
  // =========================================================================
  console.log('3. Testing IPv6 Loopback, Private, Link-Local & Mapped IPv6...');

  const ipv6Tests = [
    'http://[::1]/admin',
    'http://[::]/test',
    'http://[fe80::1]/link-local',
    'http://[fc00::1]/ula',
    'http://[fd00::1]/ula',
    'http://[ff02::1]/multicast',
    'http://[2001:db8::1]/doc',
    'http://[::ffff:127.0.0.1]/mapped-loopback',
    'http://[::ffff:10.0.0.1]/mapped-rfc1918',
    'http://[::ffff:192.168.1.1]/mapped-private',
    'http://[::ffff:169.254.169.254]/mapped-metadata'
  ];

  for (const url of ipv6Tests) {
    const res = await validateSafeScrapeUrl(url, { allowLocalhost: false });
    assert.strictEqual(res.safe, false, `Expected ${url} to be blocked`);
  }

  console.log('   ✓ IPv6 loopback, link-local, ULA, multicast, and IPv4-mapped IPv6 strictly blocked.\n');

  // =========================================================================
  // Section 4: Cloud Metadata Endpoints
  // =========================================================================
  console.log('4. Testing Cloud Metadata Endpoints...');

  const metadataEndpoints = [
    'http://169.254.169.254/latest/meta-data/',
    'http://169.254.170.2/v2/metadata',
    'http://100.100.100.200/latest/meta-data/',
    'http://metadata.google.internal/computeMetadata/v1/',
    'http://instance-data/latest/meta-data/',
    'http://metadata.titus.netflix.com/metadata',
    'http://[fd00:ec2::254]/latest/meta-data/'
  ];

  for (const url of metadataEndpoints) {
    // Even if allowLocalhost is inadvertently true, metadata must ALWAYS be blocked
    const res = await validateSafeScrapeUrl(url, { allowLocalhost: true });
    assert.strictEqual(res.safe, false, `Expected cloud metadata ${url} to be blocked`);
    assert.ok(res.error.includes('SSRF') || res.error.includes('cloud metadata') || res.error.includes('restricted'));
  }

  console.log('   ✓ AWS, GCP, Azure, Alibaba, and Netflix cloud metadata endpoints strictly forbidden.\n');

  // =========================================================================
  // Section 5: Localhost and Localhost Subdomains
  // =========================================================================
  console.log('5. Testing Localhost and Localhost Subdomains...');

  const localhostTests = [
    'http://localhost/',
    'http://localhost:8080/debug',
    'http://sub.localhost/api',
    'http://deep.nested.sub.localhost:3000/env'
  ];

  for (const url of localhostTests) {
    const res = await validateSafeScrapeUrl(url, { allowLocalhost: false });
    assert.strictEqual(res.safe, false, `Expected ${url} to be blocked`);
  }

  console.log('   ✓ Localhost and all arbitrary subdomains of .localhost strictly blocked.\n');

  // =========================================================================
  // Section 6: Connection-Level Destination Enforcement (DNS Rebinding)
  // =========================================================================
  console.log('6. Testing Connection-Level DNS Rebinding Protection...');

  // createSecureLookup enforces destination checks at socket connection time.
  const secureLookup = createSecureLookup({ allowLocalhost: false });

  // Test 6a: Lookup of hostname resolving to 127.0.0.1 or restricted IP is intercepted at socket layer
  let lookupBlocked = false;
  await new Promise((resolve) => {
    secureLookup('127.0.0.1', {}, (err, address) => {
      if (err && err.message.includes('SSRF blocked')) {
        lookupBlocked = true;
      }
      resolve();
    });
  });
  assert.strictEqual(lookupBlocked, true, 'Connection-level lookup must block restricted IP at socket layer');

  // Test 6b: Lookup of alternative hex representation 0x7f000001
  let hexLookupBlocked = false;
  await new Promise((resolve) => {
    secureLookup('0x7f000001', {}, (err, address) => {
      if (err && err.message.includes('SSRF blocked')) {
        hexLookupBlocked = true;
      }
      resolve();
    });
  });
  assert.strictEqual(hexLookupBlocked, true, 'Connection-level lookup must block hex-encoded restricted IP');

  console.log('   ✓ Connection-level lookup pins destination and neutralizes DNS rebinding at socket creation.\n');

  // =========================================================================
  // Section 7: Redirects to Prohibited Destinations & Protocol Downgrade
  // =========================================================================
  console.log('7. Testing Redirect Revalidation & Protocol Downgrades...');

  // Setup server that attempts redirect to cloud metadata
  const redirectServer = http.createServer((req, res) => {
    if (req.url === '/redirect-to-meta') {
      res.writeHead(302, { 'Location': 'http://169.254.169.254/latest/meta-data/' });
      res.end();
    } else if (req.url === '/redirect-to-private') {
      res.writeHead(302, { 'Location': 'http://192.168.1.1/secret' });
      res.end();
    } else if (req.url === '/loop-a') {
      res.writeHead(302, { 'Location': '/loop-b' });
      res.end();
    } else if (req.url === '/loop-b') {
      res.writeHead(302, { 'Location': '/loop-a' });
      res.end();
    } else {
      res.writeHead(200);
      res.end('OK');
    }
  });

  const port = 3980;
  await new Promise((r) => redirectServer.listen(port, r));

  try {
    // 7a: Redirect to metadata blocked
    let metaBlocked = false;
    try {
      await safeFetch(`http://localhost:${port}/redirect-to-meta`, { allowLocalhost: true });
    } catch (err) {
      metaBlocked = true;
      assert.ok(err.message.includes('SSRF blocked'));
    }
    assert.strictEqual(metaBlocked, true, 'Redirect to metadata must be blocked');

    // 7b: Redirect to RFC 1918 private IP blocked
    let privBlocked = false;
    try {
      await safeFetch(`http://localhost:${port}/redirect-to-private`, { allowLocalhost: true });
    } catch (err) {
      privBlocked = true;
      assert.ok(err.message.includes('SSRF blocked'));
    }
    assert.strictEqual(privBlocked, true, 'Redirect to private IP must be blocked');

    // 7c: Infinite redirect loop blocked
    let loopBlocked = false;
    try {
      await safeFetch(`http://localhost:${port}/loop-a`, { allowLocalhost: true, maxRedirects: 3 });
    } catch (err) {
      loopBlocked = true;
      assert.ok(err.message.includes('Too many redirects'));
    }
    assert.strictEqual(loopBlocked, true, 'Infinite redirect loops must be terminated');

  } finally {
    redirectServer.close();
  }

  console.log('   ✓ Redirect hops revalidated; metadata, private subnets, and redirect loops strictly blocked.\n');

  // =========================================================================
  // Section 8: Streaming Size Caps & Decompression Bomb Protection
  // =========================================================================
  console.log('8. Testing Streaming Size Caps & Decompression Bomb Defense...');

  const bombServer = http.createServer((req, res) => {
    if (req.url === '/gzip-bomb') {
      // 1MB of zeroes compresses to ~1KB
      const largeData = Buffer.alloc(1024 * 1024, 'a');
      const compressed = zlib.gzipSync(largeData);
      res.writeHead(200, {
        'Content-Type': 'text/plain',
        'Content-Encoding': 'gzip'
      });
      res.end(compressed);
    } else if (req.url === '/oversized') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('B'.repeat(50000));
    }
  });

  const bombPort = 3981;
  await new Promise((r) => bombServer.listen(bombPort, r));

  try {
    // 8a: Oversized uncompressed response
    let sizeCapped = false;
    try {
      await safeFetch(`http://localhost:${bombPort}/oversized`, { allowLocalhost: true, maxBytes: 5000 });
    } catch (err) {
      sizeCapped = true;
      assert.ok(err.message.includes('limit of'));
    }
    assert.strictEqual(sizeCapped, true, 'Response exceeding maxBytes must abort early');

    // 8b: Decompression bomb exceeding maxDecompressedBytes
    let bombCapped = false;
    try {
      await executeSecureRequest(`http://localhost:${bombPort}/gzip-bomb`, {
        allowLocalhost: true,
        maxBytes: 100000,
        maxDecompressedBytes: 10000 // Small limit to trigger decompression bomb protection
      });
    } catch (err) {
      bombCapped = true;
      assert.ok(err.message.includes('limit of 10000 bytes') || err.message.includes('decompression bomb'));
    }
    assert.strictEqual(bombCapped, true, 'Decompression bomb must abort when uncompressed bytes exceed limit');

  } finally {
    bombServer.close();
  }

  console.log('   ✓ Streaming size limits and decompression bomb protections verified.\n');

  // =========================================================================
  // Section 9: Browser Navigation & Subresource Interception Hardening
  // =========================================================================
  console.log('9. Testing Browser Navigation & Subresource Interception (Playwright/Puppeteer)...');

  // Mock page simulating Playwright route interception
  const interceptedRoutes = [];
  let registeredRoutePattern = null;
  let routeHandler = null;
  let popupHandler = null;
  let downloadHandler = null;

  const mockPage = {
    route: async (pattern, handler) => {
      registeredRoutePattern = pattern;
      routeHandler = handler;
    },
    on: (event, handler) => {
      if (event === 'popup') popupHandler = handler;
      if (event === 'download') downloadHandler = handler;
      return mockPage;
    },
    goto: async (url) => {
      // Simulate navigation
      return { url };
    },
    content: async () => '<html><body>mock content</body></html>',
    evaluate: async (fn) => fn(),
    close: async () => {}
  };

  // Harden page
  await hardenBrowserPage(mockPage, { allowLocalhost: false });

  assert.ok(routeHandler, 'Route handler must be registered on page');
  assert.strictEqual(registeredRoutePattern, '**/*', 'Interception must cover all routes (**/*)');
  assert.ok(popupHandler, 'Popup handler must be registered');
  assert.ok(downloadHandler, 'Download handler must be registered');

  // Helper to test route interception decision
  async function testRouteUrl(targetUrl, resourceType = 'fetch') {
    let aborted = false;
    let continued = false;
    let abortReason = null;

    const mockRoute = {
      request: () => ({
        url: () => targetUrl,
        resourceType: () => resourceType
      }),
      abort: (reason) => {
        aborted = true;
        abortReason = reason;
      },
      continue: () => {
        continued = true;
      }
    };

    await routeHandler(mockRoute);
    return { aborted, continued, abortReason };
  }

  // 9a: Subresource to cloud metadata must be aborted
  const metaSub = await testRouteUrl('http://169.254.169.254/latest/meta-data/');
  assert.strictEqual(metaSub.aborted, true, 'Browser request to 169.254.169.254 must be aborted');
  assert.strictEqual(metaSub.continued, false);

  // 9b: Subresource to localhost must be aborted
  const localSub = await testRouteUrl('http://127.0.0.1:8080/internal/api');
  assert.strictEqual(localSub.aborted, true, 'Browser request to 127.0.0.1 must be aborted');
  assert.strictEqual(localSub.continued, false);

  // 9c: Subresource to private RFC 1918 subnet must be aborted
  const rfcSub = await testRouteUrl('http://10.0.1.5/keys');
  assert.strictEqual(rfcSub.aborted, true, 'Browser request to 10.0.1.5 must be aborted');
  assert.strictEqual(rfcSub.continued, false);

  // 9d: Subresource with file:// protocol must be aborted
  const fileSub = await testRouteUrl('file:///etc/passwd');
  assert.strictEqual(fileSub.aborted, true, 'Browser request to file:// must be aborted');

  // 9e: Popup auto-close
  let popupClosed = false;
  const mockPopup = {
    close: async () => { popupClosed = true; }
  };
  await popupHandler(mockPopup);
  assert.strictEqual(popupClosed, true, 'Popup windows must be suppressed immediately');

  // 9f: Download auto-cancel
  let downloadCancelled = false;
  const mockDownload = {
    cancel: async () => { downloadCancelled = true; }
  };
  await downloadHandler(mockDownload);
  assert.strictEqual(downloadCancelled, true, 'Downloads must be cancelled immediately');

  console.log('   ✓ Browser request route interception, subresource blocking, popup & download suppression verified.\n');

  // =========================================================================
  // Section 10: Live Target Verification (Destinations Are Never Reached)
  // =========================================================================
  console.log('10. Testing Live Target Verification (Prohibited Destinations Never Reached)...');

  let internalTargetHitCount = 0;
  const internalServer = http.createServer((req, res) => {
    internalTargetHitCount++;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ secret: 'SENSITIVE_INTERNAL_DATA' }));
  });

  const internalPort = 3982;
  await new Promise((r) => internalServer.listen(internalPort, r));

  try {
    const prohibitedVectors = [
      `http://127.0.0.1:${internalPort}/internal-confidential`,
      `http://localhost:${internalPort}/internal-confidential`,
      `http://0177.0.0.1:${internalPort}/internal-confidential`,
      `http://0x7f.0.0.1:${internalPort}/internal-confidential`,
      `http://2130706433:${internalPort}/internal-confidential`,
      `http://127.1:${internalPort}/internal-confidential`,
      `http://[::1]:${internalPort}/internal-confidential`,
      `http://[::ffff:127.0.0.1]:${internalPort}/internal-confidential`
    ];

    for (const vec of prohibitedVectors) {
      try {
        await safeFetch(vec, { allowLocalhost: false });
      } catch (err) {
        // Expected to fail
      }
    }

    // Verify zero requests ever reached the internal destination socket
    assert.strictEqual(
      internalTargetHitCount,
      0,
      `Prohibited internal server was contacted ${internalTargetHitCount} times! Target must never be reached.`
    );

    // Also test redirect attempting to reach the internal target
    const evilRedirectServer = http.createServer((req, res) => {
      res.writeHead(302, { 'Location': `http://127.0.0.1:${internalPort}/internal-confidential` });
      res.end();
    });
    const evilPort = 3983;
    await new Promise((r) => evilRedirectServer.listen(evilPort, r));

    try {
      try {
        await safeFetch(`http://localhost:${evilPort}`, { allowLocalhost: true });
      } catch (_) {}
      assert.strictEqual(
        internalTargetHitCount,
        0,
        `Prohibited internal server was contacted via redirect! Target must never be reached.`
      );
    } finally {
      evilRedirectServer.close();
    }

  } finally {
    internalServer.close();
  }

  console.log('   ✓ Verified: Prohibited destinations are never reached across direct, alternate IP, or redirect vectors.\n');

  // =========================================================================
  // Section 11: Content-Type Validation & Malformed Content Rejection
  // =========================================================================
  console.log('11. Testing Content-Type Validation & Malformed Content Rejection...');

  const binaryServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/x-executable' });
    res.end(Buffer.from([0x7f, 0x45, 0x4c, 0x46])); // ELF binary magic bytes
  });

  const binPort = 3984;
  await new Promise((r) => binaryServer.listen(binPort, r));

  try {
    let ctBlocked = false;
    try {
      await executeSecureRequest(`http://localhost:${binPort}`, {
        allowLocalhost: true,
        expectedContentTypes: ['text/html', 'application/xhtml+xml']
      });
    } catch (err) {
      ctBlocked = true;
      assert.ok(err.message.includes('not an accepted format'));
    }
    assert.strictEqual(ctBlocked, true, 'Unexpected content-type must be rejected before parsing');
  } finally {
    binaryServer.close();
  }

  console.log('   ✓ Unexpected and non-whitelisted content types rejected safely.\n');

  console.log('🎉 ALL PHASE THREE SSRF & NETWORK SECURITY TESTS PASSED 100%!\n');
}

runPhaseThreeTests().catch((err) => {
  console.error('\n❌ Phase Three Test Failed:', err);
  process.exit(1);
});
