import { ScrapedEmailRecord } from '../types/record';
import { isDisposableDomain } from './emailExtractor';

export interface VerificationResult {
  status: 'deliverable' | 'undeliverable' | 'disposable';
  mxRecords: string[];
}

const mxCache = new Map<string, VerificationResult>();

/**
 * Resolves MX records via DNS-over-HTTPS (DoH) with multi-provider fallback (Cloudflare -> Google)
 * Works universally across Windows, macOS, and Linux without raw socket/UDP 53 firewall constraints.
 */
export async function verifyDomainMx(domain: string): Promise<VerificationResult> {
  const cleanDomain = domain.toLowerCase().trim();

  if (mxCache.has(cleanDomain)) {
    return mxCache.get(cleanDomain)!;
  }

  // Check if disposable
  if (isDisposableDomain(cleanDomain)) {
    const res: VerificationResult = {
      status: 'disposable',
      mxRecords: []
    };
    mxCache.set(cleanDomain, res);
    return res;
  }

  try {
    // 1. Try Cloudflare DoH
    const cfUrl = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(cleanDomain)}&type=MX`;
    const cfRes = await fetch(cfUrl, {
      headers: { 'accept': 'application/dns-json' },
      signal: AbortSignal.timeout(4000)
    });

    if (cfRes.ok) {
      const data = (await cfRes.json()) as any;
      if (Array.isArray(data.Answer) && data.Answer.length > 0) {
        const mxList = data.Answer
          .filter((a: any) => a.type === 15 && a.data)
          .map((a: any) => String(a.data).trim());

        if (mxList.length > 0) {
          const result: VerificationResult = {
            status: 'deliverable',
            mxRecords: mxList
          };
          mxCache.set(cleanDomain, result);
          return result;
        }
      }
    }
  } catch {
    // Fallback to Google DoH below
  }

  try {
    // 2. Fallback to Google DoH
    const googleUrl = `https://dns.google/resolve?name=${encodeURIComponent(cleanDomain)}&type=MX`;
    const gRes = await fetch(googleUrl, {
      headers: { 'accept': 'application/json' },
      signal: AbortSignal.timeout(4000)
    });

    if (gRes.ok) {
      const data = (await gRes.json()) as any;
      if (Array.isArray(data.Answer) && data.Answer.length > 0) {
        const mxList = data.Answer
          .filter((a: any) => a.type === 15 && a.data)
          .map((a: any) => String(a.data).trim());

        if (mxList.length > 0) {
          const result: VerificationResult = {
            status: 'deliverable',
            mxRecords: mxList
          };
          mxCache.set(cleanDomain, result);
          return result;
        }
      }
    }
  } catch {
    // No response from DoH providers
  }

  // If no MX records found or resolution failed
  const undeliverableResult: VerificationResult = {
    status: 'undeliverable',
    mxRecords: []
  };
  mxCache.set(cleanDomain, undeliverableResult);
  return undeliverableResult;
}

/**
 * Verifies deliverability for a batch of records concurrently
 */
export async function verifyEmailRecords(
  records: ScrapedEmailRecord[]
): Promise<ScrapedEmailRecord[]> {
  const uniqueDomains = Array.from(new Set(records.map(r => r.domain)));
  const domainMap = new Map<string, VerificationResult>();

  // Process domains in parallel chunks of 10
  const CHUNK_SIZE = 10;
  for (let i = 0; i < uniqueDomains.length; i += CHUNK_SIZE) {
    const chunk = uniqueDomains.slice(i, i + CHUNK_SIZE);
    await Promise.all(
      chunk.map(async (domain) => {
        const res = await verifyDomainMx(domain);
        domainMap.set(domain, res);
      })
    );
  }

  return records.map(r => {
    const v = domainMap.get(r.domain);
    return {
      ...r,
      mxStatus: v ? v.status : 'undeliverable',
      mxRecords: v ? v.mxRecords : []
    };
  });
}
