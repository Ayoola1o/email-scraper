import { ScrapedEmailRecord } from '../types/record';
import { isDisposableDomain } from './emailExtractor';

export interface VerificationResult {
  status: 'deliverable' | 'undeliverable' | 'disposable' | 'risky';
  mxRecords: string[];
  provider?: string;
  isCatchAll?: boolean;
}

const mxCache = new Map<string, VerificationResult>();

/**
 * Fingerprints Email Service Provider and assesses Catch-All / Accept-All security gateway risk
 */
export function detectMailProvider(mxRecords: string[]): { provider: string; isCatchAll: boolean } {
  if (!mxRecords || mxRecords.length === 0) {
    return { provider: 'Unknown', isCatchAll: false };
  }
  const joined = mxRecords.join(' ').toLowerCase();

  // Enterprise Security Gateways (known to operate Catch-All / Accept-All policies)
  if (joined.includes('pphosted.com') || joined.includes('proofpoint')) {
    return { provider: 'Proofpoint Enterprise Gateway', isCatchAll: true };
  }
  if (joined.includes('mimecast.com')) {
    return { provider: 'Mimecast Gateway', isCatchAll: true };
  }
  if (joined.includes('barracudanetworks.com') || joined.includes('barracuda')) {
    return { provider: 'Barracuda Sentinel', isCatchAll: true };
  }
  if (joined.includes('ironport') || joined.includes('iphmx.com')) {
    return { provider: 'Cisco IronPort Gateway', isCatchAll: true };
  }
  if (joined.includes('tmes.trendmicro.com') || joined.includes('trendmicro')) {
    return { provider: 'Trend Micro Email Security', isCatchAll: true };
  }

  // Major ESPs
  if (joined.includes('google.com') || joined.includes('googlemail.com') || joined.includes('aspmx.l.google.com')) {
    return { provider: 'Google Workspace', isCatchAll: false };
  }
  if (joined.includes('outlook.com') || joined.includes('protection.outlook.com') || joined.includes('lync.com')) {
    return { provider: 'Microsoft 365 / Exchange', isCatchAll: false };
  }
  if (joined.includes('zoho.com') || joined.includes('zoho.eu')) {
    return { provider: 'Zoho Mail', isCatchAll: false };
  }
  if (joined.includes('amazonaws.com') || joined.includes('awses')) {
    return { provider: 'Amazon SES', isCatchAll: false };
  }
  if (joined.includes('secureserver.net')) {
    return { provider: 'GoDaddy / Secureserver', isCatchAll: false };
  }
  if (joined.includes('ovh.net')) {
    return { provider: 'OVHcloud Mail', isCatchAll: false };
  }
  if (joined.includes('protonmail.ch') || joined.includes('proton.me')) {
    return { provider: 'ProtonMail', isCatchAll: false };
  }
  if (joined.includes('fastmail.com')) {
    return { provider: 'Fastmail', isCatchAll: false };
  }
  if (joined.includes('yahoodns.net')) {
    return { provider: 'Yahoo Mail', isCatchAll: false };
  }
  if (joined.includes('icloud.com') || joined.includes('apple.com')) {
    return { provider: 'Apple iCloud Mail', isCatchAll: false };
  }

  return { provider: 'Custom / Self-Hosted Server', isCatchAll: false };
}

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
      mxRecords: [],
      provider: 'Disposable Mail Service',
      isCatchAll: false
    };
    mxCache.set(cleanDomain, res);
    return res;
  }

  try {
    // 1. Try Cloudflare DoH
    const cfUrl = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(cleanDomain)}&type=MX`;
    const cfRes = await fetch(cfUrl, {
      headers: { 'accept': 'application/dns-json' },
      signal: AbortSignal.timeout(8000)
    });

    if (cfRes.ok) {
      const data = (await cfRes.json()) as any;
      if (Array.isArray(data.Answer) && data.Answer.length > 0) {
        const mxList = data.Answer
          .filter((a: any) => a.type === 15 && a.data)
          .map((a: any) => String(a.data).trim());

        if (mxList.length > 0) {
          const { provider, isCatchAll } = detectMailProvider(mxList);
          const result: VerificationResult = {
            status: isCatchAll ? 'risky' : 'deliverable',
            mxRecords: mxList,
            provider,
            isCatchAll
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
      signal: AbortSignal.timeout(8000)
    });

    if (gRes.ok) {
      const data = (await gRes.json()) as any;
      if (Array.isArray(data.Answer) && data.Answer.length > 0) {
        const mxList = data.Answer
          .filter((a: any) => a.type === 15 && a.data)
          .map((a: any) => String(a.data).trim());

        if (mxList.length > 0) {
          const { provider, isCatchAll } = detectMailProvider(mxList);
          const result: VerificationResult = {
            status: isCatchAll ? 'risky' : 'deliverable',
            mxRecords: mxList,
            provider,
            isCatchAll
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
    mxRecords: [],
    provider: 'None (No MX Records Found)',
    isCatchAll: false
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
      mxRecords: v ? v.mxRecords : [],
      provider: v?.provider || 'Unknown',
      isCatchAll: Boolean(v?.isCatchAll),
      validity: {
        syntax: r.validity?.syntax ?? true,
        tld: r.validity?.tld ?? true,
        isDisposable: v?.status === 'disposable',
        isCatchAll: Boolean(v?.isCatchAll),
        provider: v?.provider
      }
    };
  });
}
