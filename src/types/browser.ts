/**
 * Browser interface abstraction for Playwright and Puppeteer compatibility
 */
export interface BrowserContext {
  newPage(): Promise<Page>;
  close(): Promise<void>;
}

export interface Browser {
  newPage(): Promise<Page>;
  newContext?(options?: any): Promise<BrowserContext>;
  close(): Promise<void>;
}

export interface Page {
  goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<any>;
  content(): Promise<string>;
  evaluate<T>(fn: () => T): Promise<T>;
  close(): Promise<void>;
  route?(url: string | RegExp, handler: (route: any, request: any) => Promise<void> | void): Promise<void>;
  setRequestInterception?(value: boolean): Promise<void>;
  on?(event: string, handler: (...args: any[]) => void): any;
}

/**
 * Browser factory type for creating browser instances
 */
export type BrowserFactory = () => Promise<Browser>;

