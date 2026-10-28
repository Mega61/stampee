import { describe, expect, it } from 'vitest';
import { fetchPublicHttps, isBlockedHostname, isPrivateAddress } from '../src/lib/safeFetch.js';

describe('safeFetch guards', () => {
  it('flags private, loopback, link-local and CGNAT addresses', () => {
    for (const ip of ['10.0.0.5', '127.0.0.1', '169.254.169.254', '172.20.1.1', '192.168.1.10', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '142.250.78.14', '2607:f8b0:4004:800::200e']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it('blocks single-label, local and IP-literal hostnames before resolving', () => {
    for (const host of ['api', 'localhost', 'printer.local', 'db.internal', '10.0.0.5', '[::1]']) {
      expect(isBlockedHostname(host), host).toBe(true);
    }
    expect(isBlockedHostname('cdn.example.com')).toBe(false);
  });

  it('refuses non-https and hosts that resolve to private addresses', async () => {
    const opts = { timeoutMs: 2000, maxBytes: 1024 };
    expect(await fetchPublicHttps('http://example.com/logo.png', opts)).toBeNull();
    expect(await fetchPublicHttps('https://api:3001/logo.png', opts)).toBeNull();
    // localtest.me is a public name that resolves to 127.0.0.1; when DNS is
    // unavailable the lookup fails — either way nothing is fetched.
    expect(await fetchPublicHttps('https://localtest.me/logo.png', opts)).toBeNull();
  });
});
