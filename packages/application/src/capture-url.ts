import { isIP } from 'node:net';

const PRIVATE_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
]);

function ipv4Private(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return true;
  }
  const [a = 0, b = 0] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 192 && b === 88 && parts[2] === 99) ||
    (a === 198 && b === 51 && parts[2] === 100) ||
    (a === 203 && b === 0 && parts[2] === 113) ||
    a >= 224
  );
}

export function isPrivateAddress(address: string): boolean {
  const normalized = address.replace(/^\[|\]$/g, '').toLowerCase();
  const version = isIP(normalized);
  if (version === 4) return ipv4Private(normalized);
  if (version !== 6) return false;

  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('::ffff:')) return ipv4Private(normalized.slice(7));
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (/^fe[89ab]/.test(normalized) || /^fe[c-f]/.test(normalized)) return true;
  if (normalized.startsWith('ff')) return true;
  if (normalized.startsWith('2001:db8')) return true;
  if (normalized.startsWith('64:ff9b:') || normalized.startsWith('2002:')) return true;
  if (normalized.startsWith('2001:0:')) return true;
  return false;
}

export function isPublicHttpUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  const hostname = url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (!hostname) return false;
  if (
    PRIVATE_HOSTNAMES.has(hostname) ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    return false;
  }
  const version = isIP(hostname);
  if (version > 0) return !isPrivateAddress(hostname);
  return true;
}

export function canonicalizeUrl(value: string): string {
  const url = new URL(value);
  url.hash = '';
  const tracking = (key: string) =>
    key.startsWith('utm_') || ['fbclid', 'gclid', 'mc_cid', 'mc_eid', 'ref'].includes(key);
  for (const key of [...url.searchParams.keys()]) {
    if (tracking(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  if (
    (url.protocol === 'http:' && url.port === '80') ||
    (url.protocol === 'https:' && url.port === '443')
  ) {
    url.port = '';
  }
  return url.toString();
}
