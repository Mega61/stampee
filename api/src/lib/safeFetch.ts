// Fetch an owner-supplied external URL without letting it reach private
// networks (SSRF). The address check runs inside the socket's DNS lookup, so
// the address that was validated is the one we connect to — a hostname can't
// pass the check and then resolve somewhere internal.
import { lookup as dnsLookup } from 'node:dns';
import https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';

const parseV4 = (ip: string) => ip.split('.').map(Number) as [number, number, number, number];

/** True for loopback, private, link-local, CGNAT, multicast and other non-public ranges. */
export const isPrivateAddress = (ip: string): boolean => {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return isPrivateAddress(mapped[1]!);
  if (isIP(ip) === 4) {
    const [a, b] = parseV4(ip);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  if (isIP(ip) === 6) {
    const lower = ip.toLowerCase();
    return (
      lower === '::' || lower === '::1' ||
      /^f[cd]/.test(lower) || // fc00::/7 unique local
      /^fe[89ab]/.test(lower) || // fe80::/10 link-local
      /^ff/.test(lower) // multicast
    );
  }
  return true;
};

/** Hostnames we refuse before resolving: single-label (compose service names), local suffixes, IP literals. */
export const isBlockedHostname = (hostname: string) =>
  !hostname.includes('.') ||
  hostname === 'localhost' ||
  /\.(local|internal|localhost)$/i.test(hostname) ||
  isIP(hostname.replace(/^\[|\]$/g, '')) !== 0;

const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '', 0);
    const list = addresses as unknown as { address: string; family: number }[];
    const bad = list.find((a) => isPrivateAddress(a.address));
    if (bad || list.length === 0) {
      return callback(Object.assign(new Error('Blocked private address'), { code: 'EBLOCKED' }), '', 0);
    }
    if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: typeof list) => void)(null, list);
    callback(null, list[0]!.address, list[0]!.family);
  });
};

/**
 * GET an https URL from a public host. Resolves to the body, or null on any
 * problem (blocked host, non-200, redirect, timeout, too large).
 */
export const fetchPublicHttps = (rawUrl: string, opts: { timeoutMs: number; maxBytes: number }): Promise<Buffer | null> =>
  new Promise((resolve) => {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return resolve(null);
    }
    if (url.protocol !== 'https:' || isBlockedHostname(url.hostname)) return resolve(null);

    const req = https.get(url, { lookup: guardedLookup, timeout: opts.timeoutMs }, (res) => {
      // No redirects: the target could point anywhere.
      if (res.statusCode !== 200) {
        res.resume();
        return resolve(null);
      }
      if (Number(res.headers['content-length'] ?? 0) > opts.maxBytes) {
        res.destroy();
        return resolve(null);
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > opts.maxBytes) {
          res.destroy();
          resolve(null);
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve(size > 0 ? Buffer.concat(chunks) : null));
      res.on('error', () => resolve(null));
    });
    // `timeout` above is per-socket idleness; also cap the whole request.
    const total = setTimeout(() => req.destroy(), opts.timeoutMs);
    req.on('close', () => clearTimeout(total));
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
