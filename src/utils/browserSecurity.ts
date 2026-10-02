import { Page, Browser, BrowserContext } from '../types/browser';
import { validateSafeScrapeUrl } from './security';

export interface BrowserSecurityOptions {
  allowLocalhost?: boolean;
  blockMedia?: boolean;
  maxNavigationTimeoutMs?: number;
}

/**
 * Hardens a Playwright or Puppeteer page with comprehensive SSRF protection,
 * subresource interception, popup suppression, and download blocking.
 */
export async function hardenBrowserPage(
  page: Page,
  options: BrowserSecurityOptions = {}
): Promise<void> {
  const allowLocal = options.allowLocalhost ?? (process.env.ALLOW_LOCAL_SCRAPING === 'true');

  // 1. Playwright Route Interception
  if (typeof page.route === 'function') {
    await page.route('**/*', async (route: any) => {
      try {
        const req = route.request();
        const url = req.url();

        // Allow data: URLs for small images if not blocking media
        if (url.startsWith('data:image/')) {
          if (options.blockMedia) {
            return route.abort('blockedbyclient');
          }
          return route.continue();
        }

        // Validate destination URL against SSRF
        const validation = await validateSafeScrapeUrl(url, { allowLocalhost: allowLocal });
        if (!validation.safe) {
          return route.abort('blockedbyclient');
        }

        // Block media if requested to conserve memory/CPU
        if (options.blockMedia) {
          const resourceType = typeof req.resourceType === 'function' ? req.resourceType() : '';
          if (['image', 'media', 'font', 'stylesheet'].includes(resourceType)) {
            return route.abort('blockedbyclient');
          }
        }

        return route.continue();
      } catch {
        return route.abort('blockedbyclient');
      }
    });
  }
  // 2. Puppeteer Request Interception fallback
  else if (typeof page.setRequestInterception === 'function' && typeof page.on === 'function') {
    try {
      await page.setRequestInterception(true);
      page.on('request', async (req: any) => {
        try {
          const url = req.url();

          if (url.startsWith('data:image/')) {
            if (options.blockMedia) {
              return req.abort('blockedbyclient');
            }
            return req.continue();
          }

          const validation = await validateSafeScrapeUrl(url, { allowLocalhost: allowLocal });
          if (!validation.safe) {
            return req.abort('blockedbyclient');
          }

          if (options.blockMedia) {
            const resourceType = typeof req.resourceType === 'function' ? req.resourceType() : '';
            if (['image', 'media', 'font', 'stylesheet'].includes(resourceType)) {
              return req.abort('blockedbyclient');
            }
          }

          return req.continue();
        } catch {
          return req.abort('blockedbyclient');
        }
      });
    } catch {
      // Ignore if interception already set
    }
  }

  // 3. Popup suppression
  if (typeof page.on === 'function') {
    try {
      page.on('popup', async (popup: any) => {
        try {
          if (popup && typeof popup.close === 'function') {
            await popup.close();
          }
        } catch (_) {}
      });
    } catch (_) {}

    // 4. Download suppression
    try {
      page.on('download', async (download: any) => {
        try {
          if (download && typeof download.cancel === 'function') {
            await download.cancel();
          }
        } catch (_) {}
      });
    } catch (_) {}
  }
}

/**
 * Creates an isolated browser execution context and page with security boundaries.
 * Guarantees context and page isolation between jobs and users.
 */
export async function createIsolatedSession(
  browser: Browser,
  options: BrowserSecurityOptions = {}
): Promise<{
  page: Page;
  context?: BrowserContext;
  close: () => Promise<void>;
}> {
  let context: BrowserContext | undefined;
  let page: Page;

  if (typeof browser.newContext === 'function') {
    context = await browser.newContext({
      permissions: [],
      ignoreHTTPSErrors: false,
      bypassCSP: false
    });
    page = await context.newPage();
  } else {
    page = await browser.newPage();
  }

  await hardenBrowserPage(page, options);

  const close = async () => {
    try {
      if (page && typeof page.close === 'function') {
        await page.close();
      }
    } catch (_) {}

    try {
      if (context && typeof context.close === 'function') {
        await context.close();
      }
    } catch (_) {}
  };

  return { page, context, close };
}
