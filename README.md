# Email Scraper – Open-Source Email Extraction Tool for Websites

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)

**Email Scraper** is an open-source TypeScript library and CLI tool for extracting email addresses from webpages and entire websites. This email scraper helps developers automate email collection by providing ready-to-use modules that support both HTTP requests and headless browsers (Playwright/Puppeteer) for comprehensive web scraping.

Whether you need to scrape emails from a single contact page or crawl an entire website to collect email addresses, this tool provides a simple, reliable solution for email extraction and web scraping tasks.

## Features

- **Email Extraction from Single Pages**: Scrape email addresses from any webpage URL using HTTP requests or headless browsers
- **Website Crawling**: Automatically crawl entire websites to extract emails from multiple pages with configurable depth and page limits
- **Multiple Scraping Methods**: Choose between fast HTTP requests or full browser automation (Playwright/Puppeteer) for JavaScript-heavy sites
- **TypeScript Support**: Fully typed API for better developer experience and IDE autocomplete
- **CLI Tool**: Command-line interface for quick email scraping without writing code
- **Library API**: Import and use in your own Node.js projects for custom email scraping workflows
- **Flexible Configuration**: Customize timeout, crawl depth, page limits, and cross-domain crawling options
- **Email Normalization**: Automatically normalizes and deduplicates extracted email addresses

## Installation

### Setup

1. Clone this repository:
```bash
git clone https://github.com/web-scraping-apis/email-scraper
cd email-scraper
```

2. Install dependencies:
```bash
npm install
```

3. Build the project:
```bash
npm run build
```

### Browser Support (Optional)

For scraping JavaScript-rendered pages, install one of the supported browsers:

**Using Playwright:**
```bash
npm install playwright
npx playwright install chromium
```

**Using Puppeteer:**
```bash
npm install puppeteer
```

## Quick Start

### CLI Usage – Scrape Emails from a Single Webpage

The email scraper CLI makes it easy to extract emails from any webpage:

```bash
# Using HTTP requests (fast, for static pages)
npm run dev page https://example.com/contact

# Using headless browser (for JavaScript-rendered pages)
npm run dev page https://example.com/contact --browser

# After building, use the compiled version:
npm run scrape page https://example.com/contact
```

**CLI Options for Single Page Scraping:**
- `-t, --timeout <ms>` - Request timeout in milliseconds (default: 10000)
- `-b, --browser` - Use headless browser (Playwright/Puppeteer) instead of HTTP requests
- `--wait-until <event>` - Wait until event: `load`, `domcontentloaded`, or `networkidle` (default: `load`, browser mode only)

### CLI Usage – Scrape Emails from an Entire Website

Crawl and extract emails from multiple pages on a website:

```bash
# Using HTTP requests (default)
npm run dev website https://example.com

# Using headless browser
npm run dev website https://example.com --browser

# After building:
npm run scrape website https://example.com
```

**CLI Options for Website Crawling:**
- `-d, --max-depth <number>` - Maximum crawl depth (default: 3)
- `-p, --max-pages <number>` - Maximum number of pages to crawl (default: 50)
- `--cross-domain` - Allow crawling to different domains (default: false)
- `-b, --browser` - Use headless browser (Playwright/Puppeteer) instead of HTTP requests
- `--wait-until <event>` - Wait until event: `load`, `domcontentloaded`, or `networkidle` (default: `load`, browser mode only)

## Library Usage

Import and use the email scraper in your own TypeScript/JavaScript projects:

### Basic HTTP Email Scraping

Extract emails from a webpage using simple HTTP requests:

```typescript
import { scrapeEmailsFromUrl } from 'email-scraper';

const emails = await scrapeEmailsFromUrl('https://example.com/contact');
console.log(Array.from(emails));
// Output: ['contact@example.com', 'info@example.com']
```

### Email Scraping with Playwright

For JavaScript-rendered pages, use Playwright with the email scraper:

```typescript
import { chromium } from 'playwright';
import { scrapeEmailsFromPage } from 'email-scraper';

const browser = await chromium.launch();
const page = await browser.newPage();
const emails = await scrapeEmailsFromPage(page, 'https://example.com/contact');
await browser.close();

console.log(Array.from(emails));
```

### Email Scraping with Puppeteer

Alternatively, use Puppeteer for browser automation:

```typescript
import puppeteer from 'puppeteer';
import { scrapeEmailsFromPage } from 'email-scraper';

const browser = await puppeteer.launch();
const page = await browser.newPage();
const emails = await scrapeEmailsFromPage(page, 'https://example.com/contact');
await browser.close();
```

### Crawling an Entire Website for Emails

Use the website crawler to extract emails from multiple pages:

```typescript
import { scrapeEmailsFromWebsite } from 'email-scraper';

const emails = await scrapeEmailsFromWebsite('https://example.com', {
  maxDepth: 3,
  maxPages: 50,
  sameDomainOnly: true,
  useBrowser: false, // Set to true to use a browser
  browser: browserInstance, // Optional: pass browser instance
});

console.log(`Found ${emails.size} unique emails`);
```

### Using the EmailScraper Class

For a more object-oriented approach, use the `EmailScraper` class:

```typescript
import { EmailScraper } from 'email-scraper';
import { chromium } from 'playwright';

// With browser
const browser = await chromium.launch();
const scraper = new EmailScraper(browser);
const emails = await scraper.scrapeFromWebsite('https://example.com');
await browser.close();

// Without browser (HTTP only)
const scraper = new EmailScraper();
const emails = await scraper.scrapeFromUrl('https://example.com/contact');
```

**Note:** After building (`npm run build`), you can import from `./dist/index` instead of `./src/index` when using the library locally.

## API Reference

### Functions

- **`scrapeEmailsFromUrl(url: string, options?: HttpScraperOptions): Promise<Set<string>>`**
  - Scrapes emails from a single webpage using HTTP requests
  - Returns a Set of unique email addresses

- **`scrapeEmailsFromPage(page: Page, url: string, options?: WebpageScraperOptions): Promise<Set<string>>`**
  - Scrapes emails from a webpage using a browser page instance
  - Works with Playwright or Puppeteer page objects

- **`scrapeEmailsFromWebsite(url: string, options?: WebsiteCrawlerOptions): Promise<Set<string>>`**
  - Crawls an entire website and extracts emails from all visited pages
  - Supports configurable depth, page limits, and domain restrictions

- **`extractEmails(text: string): Set<string>`**
  - Extracts email addresses from plain text using regex patterns

- **`normalizeEmail(email: string): string`**
  - Normalizes email addresses to a standard format

### Classes

- **`EmailScraper`** - Main scraper class with convenience methods for both HTTP and browser-based scraping

## Frequently Asked Questions (FAQ)

### Q: How do I scrape emails from websites?

A: You can use the email scraper CLI or library. For a single page, use `npm run dev page <url>`. For an entire website, use `npm run dev website <url>`. The tool automatically extracts email addresses from HTML content and text.

### Q: What's the difference between HTTP and browser scraping?

A: HTTP scraping is faster and works well for static HTML pages. Browser scraping (Playwright/Puppeteer) is necessary for JavaScript-rendered content where emails are loaded dynamically. Use the `--browser` flag to enable browser mode.

### Q: How to scrape email from websites that require JavaScript?

A: Use the `--browser` option with the CLI, or use `scrapeEmailsFromPage()` with a Playwright or Puppeteer browser instance. This allows the email scraper to wait for JavaScript to execute before extracting emails.

### Q: Can I scrape emails from multiple websites at once?

A: Yes, you can use the website crawler with `--cross-domain` flag, or write a script that calls `scrapeEmailsFromUrl()` or `scrapeEmailsFromWebsite()` multiple times with different URLs.

### Q: How does the email scraper handle duplicate emails?

A: The scraper automatically deduplicates emails using a Set data structure. All functions return a `Set<string>` containing unique email addresses only.

### Q: Is this email scraper legal to use?

A: This is a tool for extracting publicly available email addresses from websites. Always respect website terms of service, robots.txt files, and applicable laws (such as GDPR, CAN-SPAM) when scraping emails. Use responsibly and ethically.

### Q: How do I install the email scraper as a library?

A: After cloning the repo and running `npm install` and `npm run build`, you can import from `./dist/index`. For npm package distribution, the library would be installed via `npm install email-scraper` (when published).

### Q: What email formats does the scraper support?

A: The email scraper recognizes standard email formats (user@domain.com) and handles various edge cases. It normalizes emails and validates them against common email patterns.

### Q: Can I use this for lead generation?

A: Yes, this email scraper can be used for lead generation by extracting contact emails from websites. However, ensure compliance with anti-spam laws and best practices for email marketing.

## Development

### Building the Project

```bash
# Install dependencies
npm install

# Build TypeScript to JavaScript
npm run build
```

### Running the CLI

```bash
# Development mode (uses ts-node, no build needed)
npm run dev page https://example.com
npm run dev website https://example.com

# Production mode (uses compiled JavaScript)
npm run scrape page https://example.com
npm run scrape website https://example.com
```

### Web Application & Live Dashboard

Email Scraper includes a full-featured interactive Web Application with real-time crawling feedback, data filtering, and one-click formatted downloads:

```bash
# Start the web app (development)
npm start

# Or in production (after npm run build)
npm run server
```

Open your browser to:
- **Web Dashboard:** [http://localhost:3000](http://localhost:3000)
- **Built-in Demo Site:** [http://localhost:3000/api/demo](http://localhost:3000/api/demo)

#### Dashboard Highlights:
- **4 Extraction Modes:** Single Page, Deep Website Crawler, Multi-URL Batch, and Raw Text / Newsletter.
- **Real-Time Crawl Telemetry:** Live SSE streaming progress bar showing active page, depth, queue size, and live hits.
- **Smart Enrichment:** Detects obfuscated emails (`[at]`, `&#64;`, `mailto:`), classifies Personal vs Role-based (`support@`, `sales@`), extracts surrounding context snippets.
- **Good Format Exporters:**
  - **CSV (Excel-Ready):** UTF-8 BOM encoding so Microsoft Excel opens it cleanly without character issues.
  - **JSON:** Pretty-printed structured JSON with metadata, titles, and timestamps.
  - **TXT:** Clean line-by-line unique email list for CRM/mailer imports.
  - **vCard (.vcf):** Electronic contact cards for direct import into Google Contacts, Apple Contacts, or Outlook.

### CLI Usage – Formatted Export & Web Server

```bash
# Scrape single page and output Excel-compatible CSV
npm run scrape page https://example.com --format csv --output contacts.csv

# Crawl website and export as JSON
npm run scrape website https://example.com -d 2 -p 20 --format json --output leads.json

# Launch the Web App from CLI
node dist/cli.js serve -p 3000
```

### REST API Endpoints

- `GET /api/health` - System status and active crawl count
- `POST /api/scrape/page` - Scrape a single URL (`{ url, timeout }`)
- `POST /api/scrape/crawl` - Start deep website crawler (`{ url, maxDepth, maxPages, delayMs }`)
- `GET /api/scrape/crawl/stream/:jobId` - Live Server-Sent Events (SSE) telemetry stream
- `POST /api/scrape/crawl/cancel/:jobId` - Abort an ongoing crawl
- `POST /api/scrape/batch` - Scrape multiple URLs (`{ urls: [...] }`)
- `POST /api/scrape/text` - Direct extraction from raw text or HTML (`{ text: "..." }`)
- `POST /api/export` - Export records into CSV, JSON, TXT, or VCF (`{ records: [...], format: "csv" }`)
- `GET /api/demo` - Built-in offline mock directory with obfuscated and role test fixtures

### Running Tests

```bash
npm test
```

### Project Structure

- `/src` - TypeScript source code
  - `/scrapers` - Scraping implementations (HTTP, webpage, website crawler)
  - `/server` - Express API server and SSE streaming
  - `/utils` - Utility functions (email extraction, formatters, browser factory)
  - `/types` - TypeScript type definitions
- `/public` - Modern Glassmorphism Web Dashboard (HTML, CSS, JS)
- `/dist` - Compiled JavaScript output
- `cli.ts` - Command-line interface implementation

## Contributing

Contributions are welcome! If you find a bug or have a feature request, please open an issue on GitHub.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

---

**Keywords:** email scraper, email extraction, web scraper, email harvesting, website crawler, email finder, contact scraper, lead generation tool, web scraping library, TypeScript scraper, Playwright scraper, Puppeteer scraper, email collection tool
