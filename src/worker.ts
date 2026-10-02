import { jobQueue, jobStore } from './jobs';

/**
 * Dedicated Standalone Worker Process (Phase Five Durable Job Architecture)
 * Recovers pending/stale jobs and continuously processes distributed crawl queues.
 */
async function runStandaloneWorker() {
  console.log('\n======================================================');
  console.log('⚙️  Email Scraper Pro - Dedicated Crawl Worker Process');
  console.log('======================================================\n');

  console.log('1. Recovering any in-flight / stale jobs from previous run...');
  await jobQueue.recoverOnStartup();
  console.log('   ✓ Startup recovery complete.');

  console.log('2. Worker process listening for queued jobs...');
  const heartbeat = setInterval(async () => {
    const metrics = await jobQueue.getMetrics();
    console.log(`[Worker Status] Queued: ${metrics.queued} | Running: ${metrics.running} | Completed: ${metrics.completed} | Failed: ${metrics.failed}`);
  }, 30000);
  heartbeat.unref();

  const shutdown = async () => {
    console.log('\nReceived shutdown signal. Gracefully stopping worker...');
    clearInterval(heartbeat);
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  runStandaloneWorker().catch(err => {
    console.error('Fatal worker process error:', err);
    process.exit(1);
  });
}

export { runStandaloneWorker };
