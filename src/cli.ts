#!/usr/bin/env node

import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import {
  scrapeEmailRecordsFromUrl,
  scrapeEmailRecordsFromWebsite,
  scrapeEmailsFromPage,
  formatRecords,
  ScrapedEmailRecord
} from './index';
import { createBrowser } from './utils/browserFactory';
import { startServer } from './server/index';

const program = new Command();

program
  .name('email-scraper')
  .description('A complete CLI and Web application for extracting, enriching, and formatting emails from webpages and websites')
  .version('1.1.0');

/**
 * Helper to handle output formatting and file saving in CLI
 */
function handleCliOutput(
  records: ScrapedEmailRecord[],
  options: { format?: string; output?: string }
) {
  const format = (options.format || 'txt').toLowerCase() as 'csv' | 'json' | 'txt' | 'vcf';
  const formatted = formatRecords(records, format);

  if (options.output) {
    const resolvedPath = path.resolve(process.cwd(), options.output);
    fs.writeFileSync(resolvedPath, formatted.data, 'utf-8');
    console.log(`\n💾 Successfully exported ${records.length} record(s) to: ${resolvedPath}`);
  } else if (options.format) {
    console.log(`\n--- Exported Output (${format.toUpperCase()}) ---`);
    console.log(formatted.data);
    console.log('-----------------------------------');
  } else {
    console.log(`\n📊 Results:`);
    if (records.length === 0) {
      console.log('   No emails found.');
    } else {
      console.log(`   Found ${records.length} unique email(s):\n`);
      records.forEach((r) => {
        const typeBadge = r.type === 'personal' ? '[Personal]' : '[Role/Dept]';
        console.log(`     ${r.email.padEnd(35)} ${typeBadge.padEnd(12)} (${r.domain})`);
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Single Webpage Command
// ---------------------------------------------------------------------------
program
  .command('page')
  .description('Scrape emails from a single webpage with enriched metadata and formats')
  .argument('<url>', 'URL of the webpage to scrape')
  .option('-t, --timeout <ms>', 'Request timeout in milliseconds', '10000')
  .option('-b, --browser', 'Use headless browser (Playwright/Puppeteer) instead of HTTP requests', false)
  .option('--wait-until <event>', 'Wait until event (load, domcontentloaded, networkidle)', 'load')
  .option('-f, --format <format>', 'Export format: csv, json, txt, vcf')
  .option('-o, --output <file>', 'Save output to a destination file')
  .action(async (url: string, options: { timeout: string; browser: boolean; waitUntil: string; format?: string; output?: string }) => {
    try {
      console.log(`\n🚀 Scraping emails from: ${url}`);
      console.log(`   Method: ${options.browser ? 'Headless browser' : 'HTTP requests'}`);
      if (options.browser) {
        console.log(`   Wait until: ${options.waitUntil}`);
      }
      console.log(`   Timeout: ${options.timeout}ms\n`);

      let records: ScrapedEmailRecord[] = [];

      if (options.browser) {
        console.log('   Initializing headless browser...');
        const browser = await createBrowser();
        console.log('   ✓ Browser ready');
        try {
          console.log(`   📄 Loading page: ${url}...`);
          const page = await browser.newPage();
          const emailSet = await scrapeEmailsFromPage(page, url, {
            timeout: parseInt(options.timeout, 10),
            waitUntil: options.waitUntil as 'load' | 'domcontentloaded' | 'networkidle',
          });
          const now = new Date().toISOString();
          records = Array.from(emailSet).map(email => ({
            email,
            domain: email.split('@')[1] || '',
            type: 'role',
            sourceUrl: url,
            discoveredAt: now
          }));
          await page.close();
          console.log('   ✓ Page loaded and scraped');
        } finally {
          console.log('   Closing browser...');
          await browser.close();
        }
      } else {
        console.log(`   📄 Fetching: ${url}...`);
        const res = await scrapeEmailRecordsFromUrl(url, {
          timeout: parseInt(options.timeout, 10),
        });
        records = res.records;
        console.log(`   ✓ Page fetched: "${res.pageTitle || 'Untitled'}" (${res.statusCode})`);
      }

      handleCliOutput(records, options);
    } catch (error) {
      console.error('\n❌ Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// Website Crawler Command
// ---------------------------------------------------------------------------
program
  .command('website')
  .description('Scrape emails from an entire website by crawling from a homepage')
  .argument('<url>', 'URL of the website homepage to start crawling from')
  .option('-d, --max-depth <number>', 'Maximum crawl depth', '3')
  .option('-p, --max-pages <number>', 'Maximum number of pages to crawl', '50')
  .option('--cross-domain', 'Allow crawling to different domains', false)
  .option('-b, --browser', 'Use headless browser (Playwright/Puppeteer) instead of HTTP requests', false)
  .option('--wait-until <event>', 'Wait until event (load, domcontentloaded, networkidle)', 'load')
  .option('-f, --format <format>', 'Export format: csv, json, txt, vcf')
  .option('-o, --output <file>', 'Save output to a destination file')
  .action(async (url: string, options: { maxDepth: string; maxPages: string; crossDomain: boolean; browser: boolean; waitUntil: string; format?: string; output?: string }) => {
    try {
      console.log(`\n🚀 Starting website crawl from: ${url}`);
      console.log(`   Max depth: ${options.maxDepth} | Max pages: ${options.maxPages} | Cross-domain: ${options.crossDomain ? 'Yes' : 'No'}`);
      console.log(`   Method: ${options.browser ? 'Headless browser' : 'HTTP requests'}\n`);

      let browser: import('./types/browser').Browser | undefined;

      if (options.browser) {
        console.log('   Initializing headless browser...');
        browser = await createBrowser();
        console.log('   ✓ Browser ready\n');
      }

      let pagesVisited = 0;
      let errors = 0;

      try {
        const result = await scrapeEmailRecordsFromWebsite(url, {
          maxDepth: parseInt(options.maxDepth, 10),
          maxPages: parseInt(options.maxPages, 10),
          sameDomainOnly: !options.crossDomain,
          useBrowser: options.browser,
          browser,
          waitUntil: options.waitUntil as 'load' | 'domcontentloaded' | 'networkidle',
          onProgress: (prog) => {
            pagesVisited = prog.pagesVisited;
            const indent = '  '.repeat(prog.depth);
            const emailInfo = prog.emailsFoundOnPage > 0 ? ` (${prog.emailsFoundOnPage} email${prog.emailsFoundOnPage !== 1 ? 's' : ''})` : '';
            console.log(`${indent}📄 [${prog.pagesVisited}/${options.maxPages}] Depth ${prog.depth}: ${prog.url}${emailInfo}`);
          },
          onError: (errorUrl, error) => {
            errors++;
            console.error(`   ❌ Error on ${errorUrl}: ${error.message}`);
          },
        });

        console.log(`\n📊 Crawl Summary:`);
        console.log(`   Pages visited: ${result.pagesVisited}`);
        console.log(`   Errors: ${result.errors}`);
        console.log(`   Total unique emails found: ${result.records.length}`);

        handleCliOutput(result.records, options);
      } finally {
        if (browser) {
          console.log('\n   Closing browser...');
          await browser.close();
        }
      }
    } catch (error) {
      console.error('\n❌ Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// Web App Dashboard Serve Command
// ---------------------------------------------------------------------------
program
  .command('serve')
  .description('Launch the EmailScraper Pro interactive Web Dashboard and API server')
  .option('-p, --port <port>', 'Server port', '3000')
  .action((options: { port: string }) => {
    const port = parseInt(options.port, 10) || 3000;
    startServer(port);
  });

program.parse();
