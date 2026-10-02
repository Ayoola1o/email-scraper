const assert = require('assert');
const http = require('http');
const { startServer } = require('./dist/server/index.js');
const {
  jobQueue,
  jobStore,
  eventBus,
  LocalEventBus,
  FileJobStore,
  DurableJobQueue,
  CrawlJobWorker
} = require('./dist/jobs/index.js');
const { TokenManager } = require('./dist/auth/index.js');

async function runPhase5DurableJobsTests() {
  console.log('\n⚙️  Starting Phase Five: Durable Crawl Jobs & Resource Management Test Suite...\n');

  const TEST_PORT = 3030;
  const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
  const server = startServer(TEST_PORT);

  // Give server time to bind
  await new Promise(r => setTimeout(r, 600));

  // Generate tokens for testing multi-tenant ownership
  const aliceSession = TokenManager.createSessionToken({ id: 'usr_alice', username: 'alice', role: 'user' });
  const bobSession = TokenManager.createSessionToken({ id: 'usr_bob', username: 'bob', role: 'user' });
  const adminSession = TokenManager.createSessionToken({ id: 'usr_admin', username: 'admin', role: 'admin' });

  try {
    /* ========================================================================= */
    /* 1. Durable Job Persistence & Atomic File Store                           */
    /* ========================================================================= */
    console.log('1. Testing Durable Job Persistence & Atomic File Store...');

    const testJobId = 'job_persist_test_1';
    await jobStore.saveJob({
      id: testJobId,
      url: 'https://example.com',
      status: 'queued',
      ownerId: 'usr_alice',
      params: { maxDepth: 2, maxPages: 10 },
      records: [{ email: 'contact@example.com', domain: 'example.com', type: 'role', sourceUrl: 'https://example.com', discoveredAt: new Date().toISOString() }],
      pagesVisited: 1,
      errors: 0,
      startedAt: Date.now() - 5000,
      cancelled: false,
      retryCount: 0,
      maxRetries: 2,
      isBrowser: false,
      expiresAt: Date.now() + 86400000,
      updatedAt: Date.now()
    });

    const retrievedJob = await jobStore.getJob(testJobId);
    assert.ok(retrievedJob, 'Job must be retrievable from persistent store');
    assert.strictEqual(retrievedJob.id, testJobId);
    assert.strictEqual(retrievedJob.records.length, 1);
    assert.strictEqual(retrievedJob.records[0].email, 'contact@example.com');
    console.log('   ✓ Durable job atomic save and retrieval verified.');

    /* ========================================================================= */
    /* 2. Crash Recovery & Stale Job Re-queueing Across Restarts                 */
    /* ========================================================================= */
    console.log('\n2. Testing Crash Recovery & Stale Job Recovery...');

    const crashedJobId = 'job_crashed_1';
    await jobStore.saveJob({
      id: crashedJobId,
      url: 'https://example.com/crashed',
      status: 'running', // in-flight when server crashed
      ownerId: 'usr_alice',
      params: { maxDepth: 1, maxPages: 5 },
      records: [],
      pagesVisited: 0,
      errors: 0,
      startedAt: Date.now() - 10000,
      cancelled: false,
      retryCount: 0,
      maxRetries: 2,
      isBrowser: false,
      expiresAt: Date.now() + 86400000,
      updatedAt: Date.now()
    });

    // Run recovery logic
    const recoveredJobs = await jobStore.recoverStaleJobs();
    const recoveredItem = recoveredJobs.find(j => j.id === crashedJobId);
    assert.ok(recoveredItem, 'Crashed job must be recovered');
    assert.strictEqual(recoveredItem.status, 'queued', 'In-flight job with remaining retries must be re-queued');
    assert.strictEqual(recoveredItem.retryCount, 1);
    console.log('   ✓ Stale in-flight jobs accurately recovered on startup.');

    /* ========================================================================= */
    /* 3. Bounded Queue & Backpressure Rejection (HTTP 429)                      */
    /* ========================================================================= */
    console.log('\n3. Testing Bounded Queue Capacity & Backpressure...');

    const smallQueueStore = new FileJobStore();
    const smallQueue = new DurableJobQueue({
      jobStore: smallQueueStore,
      maxQueueCapacity: 2,
      maxConcurrentJobs: 1
    });

    // Enqueue 2 jobs (reaches capacity)
    await smallQueue.enqueue('https://demo1.com', { maxDepth: 1 }, 'usr_alice');
    await smallQueue.enqueue('https://demo2.com', { maxDepth: 1 }, 'usr_alice');

    // 3rd enqueue must throw QueueCapacityExceededError
    let threwBackpressure = false;
    try {
      await smallQueue.enqueue('https://demo3.com', { maxDepth: 1 }, 'usr_alice');
    } catch (err) {
      threwBackpressure = err.name === 'QueueCapacityExceededError';
    }
    assert.strictEqual(threwBackpressure, true, 'Queue must reject excess submissions when capacity is reached');
    console.log('   ✓ Bounded queue capacity & backpressure defense verified.');

    /* ========================================================================= */
    /* 4. SSE Reconnecting Clients & Event Replay (Last-Event-ID)                */
    /* ========================================================================= */
    console.log('\n4. Testing SSE Reconnecting Clients & Last-Event-ID Replay...');

    const sseJobId = 'job_sse_replay_test';
    await jobStore.saveJob({
      id: sseJobId,
      url: `${BASE_URL}/api/demo`,
      status: 'running',
      ownerId: 'usr_alice',
      params: { maxDepth: 1, maxPages: 5 },
      records: [],
      pagesVisited: 0,
      errors: 0,
      startedAt: Date.now(),
      cancelled: false,
      retryCount: 0,
      maxRetries: 2,
      isBrowser: false,
      expiresAt: Date.now() + 86400000,
      updatedAt: Date.now()
    });

    // Publish 3 sequential events to the event bus
    eventBus.publish(sseJobId, 'progress', { pagesVisited: 1, message: 'Visited page 1' });
    eventBus.publish(sseJobId, 'record', { email: 'test1@example.com' });
    eventBus.publish(sseJobId, 'record', { email: 'test2@example.com' });

    // Client reconnects specifying Last-Event-ID header: job_sse_replay_test:1
    const reconnectRes = await fetch(`${BASE_URL}/api/scrape/crawl/stream/${sseJobId}`, {
      headers: {
        'Authorization': `Bearer ${aliceSession.token}`,
        'Last-Event-ID': `${sseJobId}:1`
      }
    });

    assert.strictEqual(reconnectRes.status, 200);
    assert.strictEqual(reconnectRes.headers.get('content-type'), 'text/event-stream');

    const reader = reconnectRes.body.getReader();
    const decoder = new TextDecoder();
    let streamChunks = '';

    // Read initial replayed events
    const { value } = await reader.read();
    streamChunks += decoder.decode(value);
    await reader.cancel();

    // Verify replay of sequence 2 and sequence 3
    assert.ok(streamChunks.includes(`id: ${sseJobId}:2`), 'Event sequence 2 must be replayed');
    assert.ok(streamChunks.includes(`id: ${sseJobId}:3`), 'Event sequence 3 must be replayed');
    assert.ok(streamChunks.includes('test1@example.com'), 'Missed record 1 must be replayed');
    assert.ok(streamChunks.includes('test2@example.com'), 'Missed record 2 must be replayed');
    console.log('   ✓ Reconnecting SSE client received accurate event replay via Last-Event-ID.');

    /* ========================================================================= */
    /* 5. Heartbeat Generation on Active Streams                                 */
    /* ========================================================================= */
    console.log('\n5. Testing SSE Heartbeat Generation...');
    const formattedHeartbeat = LocalEventBus.formatHeartbeat(1700000000000);
    assert.ok(formattedHeartbeat.startsWith('event: heartbeat\ndata: {"timestamp":1700000000000}\n\n'));
    console.log('   ✓ Heartbeat framing verified.');

    /* ========================================================================= */
    /* 6. Multi-Tenant Authorization & IDOR Protection on Streams & Jobs        */
    /* ========================================================================= */
    console.log('\n6. Testing Multi-Tenant Authorization & IDOR Stream Protection...');

    // Bob attempts to stream Alice's crawl job -> 403 IDOR
    const idorStreamRes = await fetch(`${BASE_URL}/api/scrape/crawl/stream/${sseJobId}`, {
      headers: { 'Authorization': `Bearer ${bobSession.token}` }
    });
    assert.strictEqual(idorStreamRes.status, 403);
    const idorData = await idorStreamRes.json();
    assert.strictEqual(idorData.code, 'IDOR_ACCESS_DENIED');
    console.log('   ✓ Cross-tenant stream inspection strictly rejected with HTTP 403 IDOR_ACCESS_DENIED.');

    // Bob attempts to cancel Alice's crawl job -> 403 IDOR
    const idorCancelRes = await fetch(`${BASE_URL}/api/scrape/crawl/cancel/${sseJobId}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${bobSession.token}` }
    });
    assert.strictEqual(idorCancelRes.status, 403);
    console.log('   ✓ Cross-tenant job cancellation strictly rejected with HTTP 403.');

    // Alice accesses her own job -> 200 OK
    const aliceJobRes = await fetch(`${BASE_URL}/api/scrape/crawl/jobs/${sseJobId}`, {
      headers: { 'Authorization': `Bearer ${aliceSession.token}` }
    });
    assert.strictEqual(aliceJobRes.status, 200);
    const aliceJobData = await aliceJobRes.json();
    assert.strictEqual(aliceJobData.job.id, sseJobId);
    console.log('   ✓ Resource owner successfully accessed own job.');

    // Admin accesses Alice's job -> 200 OK
    const adminJobRes = await fetch(`${BASE_URL}/api/scrape/crawl/jobs/${sseJobId}`, {
      headers: { 'Authorization': `Bearer ${adminSession.token}` }
    });
    assert.strictEqual(adminJobRes.status, 200);
    console.log('   ✓ Administrator authorized to inspect cross-tenant job.');

    /* ========================================================================= */
    /* 7. Cancellation Propagation Across Queue & Worker                        */
    /* ========================================================================= */
    console.log('\n7. Testing Cancellation Propagation...');

    const cancelJob = await jobQueue.enqueue('https://demo-cancel.com', { maxDepth: 1 }, 'usr_alice');
    const cancelRes = await jobQueue.cancelJob(cancelJob.id, 'usr_alice');
    assert.strictEqual(cancelRes.success, true);

    const cancelledMetadata = await jobStore.getJob(cancelJob.id);
    assert.strictEqual(cancelledMetadata.status, 'cancelled');
    console.log('   ✓ Cancellation successfully propagated and job transitioned to cancelled.');

    /* ========================================================================= */
    /* 8. Job Expiration & Configurable Retention Pruning                        */
    /* ========================================================================= */
    console.log('\n8. Testing Job Expiration & Retention Pruning...');

    const oldJobId = 'job_expired_old';
    await jobStore.saveJob({
      id: oldJobId,
      url: 'https://example.com/old',
      status: 'completed',
      ownerId: 'usr_alice',
      params: {},
      records: [],
      pagesVisited: 5,
      errors: 0,
      startedAt: Date.now() - (48 * 3600 * 1000), // 48 hours ago
      endedAt: Date.now() - (48 * 3600 * 1000),
      cancelled: false,
      retryCount: 0,
      maxRetries: 2,
      isBrowser: false,
      expiresAt: Date.now() - (24 * 3600 * 1000), // Expired 24 hours ago
      updatedAt: Date.now() - (48 * 3600 * 1000)
    });

    const prunedCount = await jobStore.pruneExpiredJobs(24 * 3600 * 1000); // 24 hour threshold
    assert.ok(prunedCount >= 1, 'Expired job must be pruned');
    const oldJobLookup = await jobStore.getJob(oldJobId);
    assert.strictEqual(oldJobLookup, null, 'Pruned job must no longer exist in store');
    console.log('   ✓ Configurable job retention pruning safely purged expired records.');

    /* ========================================================================= */
    /* 9. Job List and Metrics Endpoints                                         */
    /* ========================================================================= */
    console.log('\n9. Testing GET /api/scrape/crawl/jobs & Metrics...');

    const listRes = await fetch(`${BASE_URL}/api/scrape/crawl/jobs`, {
      headers: { 'Authorization': `Bearer ${aliceSession.token}` }
    });
    assert.strictEqual(listRes.status, 200);
    const listData = await listRes.json();
    assert.strictEqual(listData.success, true);
    assert.ok(Array.isArray(listData.jobs));
    console.log(`   ✓ User jobs listed successfully (${listData.jobs.length} jobs found).`);

    const metricsRes = await fetch(`${BASE_URL}/api/scrape/crawl/metrics`, {
      headers: { 'Authorization': `Bearer ${adminSession.token}` }
    });
    assert.strictEqual(metricsRes.status, 200);
    const metricsData = await metricsRes.json();
    assert.strictEqual(metricsData.success, true);
    assert.ok(typeof metricsData.metrics.queued === 'number');
    assert.ok(typeof metricsData.metrics.running === 'number');
    console.log('   ✓ Crawl queue metrics endpoint verified.');

    console.log('\n🎉 ALL PHASE FIVE DURABLE CRAWL JOBS & RESOURCE MANAGEMENT TESTS PASSED 100%!\n');
  } finally {
    server.close();
    console.log('Test server shut down gracefully.');
  }
}

runPhase5DurableJobsTests().catch(err => {
  console.error('Phase 5 Durable Jobs Test failed:', err);
  process.exit(1);
});
