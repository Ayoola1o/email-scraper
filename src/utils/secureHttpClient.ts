import http from 'http';
import https from 'https';
import dns from 'dns/promises';
import zlib from 'zlib';
import { URL } from 'url';
import {
  isRestrictedIpAddress,
  normalizeAlternativeIpString,
  validateSafeScrapeUrl,
  CRAWL_SECURITY_LIMITS
} from './security';

export interface SecureRequestOptions {
  method?: string;
  timeout?: number;
  headers?: Record<string, string>;
  maxRedirects?: number;
  maxBytes?: number;
  maxDecompressedBytes?: number;
  allowLocalhost?: boolean;
  expectedContentTypes?: string[];
}

export interface SecureResponseResult {
  text: string;
  status: number;
  finalUrl: string;
  headers: Record<string, string>;
}

/**
 * Creates custom DNS lookup for Node http/https Agent.
 * Guarantees connection-level destination enforcement:
 * Even if DNS changes between initial validation and socket connection (DNS Rebinding),
 * the socket lookup handler checks every IP right before connecting.
 * Pins connection to the verified safe IP.
 */
export function createSecureLookup(options: { allowLocalhost?: boolean } = {}): any {
  return (
    hostname: string,
    opts: any,
    callback: (err: any, address?: any, family?: any) => void
  ) => {
    (async () => {
      try {
        const cleanHost = hostname.toLowerCase().replace(/^\[|\]$/g, '');

        // 1. Check alternative IP formats
        const altIp = normalizeAlternativeIpString(cleanHost);
        const targetHost = altIp || cleanHost;

        const isLoop = targetHost === 'localhost' || targetHost === '127.0.0.1' || targetHost === '::1' || targetHost.startsWith('127.');
        if (isRestrictedIpAddress(targetHost)) {
          if (!(options.allowLocalhost && isLoop)) {
            return callback(new Error(`SSRF blocked: Target "${hostname}" is a restricted IP`));
          }
        }

        // 2. Dual-stack DNS resolution
        const [ipv4, ipv6] = await Promise.all([
          dns.resolve4(cleanHost).catch(() => [] as string[]),
          dns.resolve6(cleanHost).catch(() => [] as string[])
        ]);

        const allAddrs = [...ipv4, ...ipv6];
        if (allAddrs.length === 0) {
          const lookup = await dns.lookup(cleanHost, { all: true }).catch(() => []);
          for (const item of lookup) allAddrs.push(item.address);
        }

        if (allAddrs.length === 0) {
          return callback(new Error(`SSRF blocked: Could not resolve hostname "${hostname}"`));
        }

        // 3. Verify ALL resolved IPs are safe
        for (const addr of allAddrs) {
          const addrLoop = addr === '127.0.0.1' || addr === '::1' || addr.startsWith('127.');
          if (isRestrictedIpAddress(addr)) {
            if (!(options.allowLocalhost && addrLoop)) {
              return callback(new Error(`SSRF blocked: Hostname "${hostname}" resolves to restricted IP ${addr}`));
            }
          }
        }

        // 4. Pin socket to first validated IP
        const selectedIp = allAddrs[0];
        const family = selectedIp.includes(':') ? 6 : 4;
        if (opts && opts.all) {
          callback(null, [{ address: selectedIp, family }] as any);
        } else {
          callback(null, selectedIp, family);
        }
      } catch (err: any) {
        callback(err);
      }
    })();
  };
}

/**
 * Secure HTTP/HTTPS agent pool with connection-level DNS pinning
 */
export function createSecureAgents(allowLocalhost = false) {
  const lookup = createSecureLookup({ allowLocalhost });
  return {
    httpAgent: new http.Agent({
      keepAlive: false,
      lookup: lookup as any
    }),
    httpsAgent: new https.Agent({
      keepAlive: false,
      lookup: lookup as any,
      // Enforce TLS verification strictly
      rejectUnauthorized: true
    })
  };
}

/**
 * Executes an HTTP/HTTPS request with:
 * 1. Connection-level destination enforcement (DNS rebinding protection)
 * 2. Streaming response size limit enforcement (early abort)
 * 3. Decompression bomb protection (limits decompressed byte count)
 * 4. Stalled stream timeout
 * 5. Manual redirect hop revalidation with protocol downgrade prevention
 */
export async function executeSecureRequest(
  initialUrl: string,
  options: SecureRequestOptions = {}
): Promise<SecureResponseResult> {
  const {
    method = 'GET',
    timeout = CRAWL_SECURITY_LIMITS.REQUEST_TIMEOUT_MS,
    headers = {},
    maxRedirects = CRAWL_SECURITY_LIMITS.MAX_REDIRECTS,
    maxBytes = CRAWL_SECURITY_LIMITS.MAX_RESPONSE_BYTES,
    allowLocalhost = false,
    expectedContentTypes
  } = options;

  const maxDecompressedBytes = options.maxDecompressedBytes ?? (maxBytes * 2);

  let currentUrl = initialUrl;
  let redirectCount = 0;
  const initialProtocol = new URL(initialUrl).protocol;

  const { httpAgent, httpsAgent } = createSecureAgents(allowLocalhost);

  while (true) {
    // 1. SSRF validation of target URL
    const validation = await validateSafeScrapeUrl(currentUrl, { allowLocalhost });
    if (!validation.safe) {
      throw new Error(`SSRF blocked request to "${currentUrl}": ${validation.error}`);
    }

    const parsed = new URL(currentUrl);

    // Reject userinfo
    if (parsed.username || parsed.password) {
      throw new Error('SSRF blocked: URL credentials (userinfo) are not allowed');
    }

    // Protocol enforcement
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`SSRF blocked: Invalid protocol "${parsed.protocol}". Only HTTP and HTTPS are allowed.`);
    }

    const isHttps = parsed.protocol === 'https:';
    const client = isHttps ? https : http;
    const agent = isHttps ? httpsAgent : httpAgent;

    const requestHeaders: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      ...headers
    };

    const result = await new Promise<SecureResponseResult | { redirectUrl: string }>((resolve, reject) => {
      let isDone = false;
      const req = client.request(
        parsed,
        {
          method,
          agent,
          headers: requestHeaders,
          // For HTTPS, preserve TLS SNI hostname verification
          servername: parsed.hostname
        },
        (res) => {
          const status = res.statusCode || 200;
          const resHeaders: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (v) resHeaders[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
          }

          // Handle Redirects
          if ([301, 302, 303, 307, 308].includes(status)) {
            const location = res.headers.location;
            if (!location) {
              cleanup();
              return reject(new Error(`Redirect ${status} returned without Location header`));
            }

            const nextUrl = new URL(location, currentUrl).href;
            const nextParsed = new URL(nextUrl);

            // Protocol downgrade check
            if (initialProtocol === 'https:' && nextParsed.protocol === 'http:') {
              cleanup();
              return reject(new Error('Insecure protocol downgrade from HTTPS to HTTP blocked (SSRF protection)'));
            }

            // Loopback and internal cross-port redirect defense
            const nextHost = nextParsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
            const nextAlt = normalizeAlternativeIpString(nextHost) || nextHost;
            const nextIsLoop = nextAlt === 'localhost' || nextAlt === '127.0.0.1' || nextAlt === '::1' || nextAlt.startsWith('127.');

            const initialParsed = new URL(initialUrl);
            const initHost = initialParsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
            const initAlt = normalizeAlternativeIpString(initHost) || initHost;
            const initIsLoop = initAlt === 'localhost' || initAlt === '127.0.0.1' || initAlt === '::1' || initAlt.startsWith('127.');

            if (nextIsLoop) {
              if (!initIsLoop) {
                cleanup();
                return reject(new Error('SSRF blocked: Redirect to localhost or loopback destination is forbidden'));
              }
              const initPort = initialParsed.port || (initialParsed.protocol === 'https:' ? '443' : '80');
              const nextPort = nextParsed.port || (nextParsed.protocol === 'https:' ? '443' : '80');
              if (initPort !== nextPort) {
                cleanup();
                return reject(new Error(`SSRF blocked: Cross-port redirect to port ${nextPort} is forbidden`));
              }
            }

            cleanup();
            res.resume(); // discard body
            return resolve({ redirectUrl: nextUrl });
          }

          // Content-Length check
          const cl = res.headers['content-length'];
          if (cl && parseInt(cl, 10) > maxBytes) {
            cleanup();
            res.destroy();
            return reject(new Error(`Response size ${cl} bytes exceeds limit of ${maxBytes} bytes`));
          }

          // Content-Type validation
          const contentType = res.headers['content-type'] || '';
          if (expectedContentTypes && expectedContentTypes.length > 0) {
            const matchesExpected = expectedContentTypes.some(t => contentType.toLowerCase().includes(t.toLowerCase()));
            if (!matchesExpected) {
              cleanup();
              res.destroy();
              return reject(new Error(`Content-Type "${contentType}" is not an accepted format`));
            }
          }

          // Setup Decompression stream if needed
          const contentEncoding = (res.headers['content-encoding'] || '').toLowerCase();
          let stream: NodeJS.ReadableStream = res;

          if (contentEncoding === 'gzip') {
            stream = res.pipe(zlib.createGunzip());
          } else if (contentEncoding === 'deflate') {
            stream = res.pipe(zlib.createInflate());
          } else if (contentEncoding === 'br') {
            stream = res.pipe(zlib.createBrotliDecompress());
          }

          const chunks: Buffer[] = [];
          let totalBytes = 0;

          // Stalled response watchdog: abort if stream stalls for more than 5000ms between chunks
          let chunkTimer: NodeJS.Timeout;
          const resetChunkTimer = () => {
            clearTimeout(chunkTimer);
            chunkTimer = setTimeout(() => {
              if (!isDone) {
                cleanup();
                res.destroy();
                reject(new Error(`Response body stream stalled; no data received within chunk timeout`));
              }
            }, 5000);
          };

          resetChunkTimer();

          stream.on('data', (chunk: Buffer) => {
            resetChunkTimer();
            totalBytes += chunk.length;

            const limitToCheck = contentEncoding ? maxDecompressedBytes : maxBytes;
            if (totalBytes > limitToCheck) {
              clearTimeout(chunkTimer);
              cleanup();
              res.destroy();
              const limitName = contentEncoding ? 'Decompressed response size' : 'Response size';
              reject(new Error(`${limitName} exceeded limit of ${limitToCheck} bytes`));
              return;
            }
            chunks.push(chunk);
          });

          stream.on('end', () => {
            clearTimeout(chunkTimer);
            cleanup();
            const text = Buffer.concat(chunks).toString('utf8');
            resolve({
              text,
              status,
              finalUrl: currentUrl,
              headers: resHeaders
            });
          });

          stream.on('error', (err) => {
            clearTimeout(chunkTimer);
            cleanup();
            reject(new Error(`Failed to decode response stream: ${err.message}`));
          });
        }
      );

      // Lifecycle timeout
      const timeoutTimer = setTimeout(() => {
        cleanup();
        req.destroy();
        reject(new Error(`Request timed out after ${timeout}ms`));
      }, timeout);

      const cleanup = () => {
        isDone = true;
        clearTimeout(timeoutTimer);
      };

      req.on('error', (err) => {
        cleanup();
        reject(err);
      });

      req.end();
    });

    if ('redirectUrl' in result) {
      redirectCount++;
      if (redirectCount > maxRedirects) {
        throw new Error(`Too many redirects (exceeded limit of ${maxRedirects})`);
      }
      currentUrl = result.redirectUrl;
      continue;
    }

    return result;
  }
}
