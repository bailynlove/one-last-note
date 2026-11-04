import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { LookupFunction } from 'node:net';
import type { CaptureFetcher, CaptureResource } from '@oln/application';
import { isPrivateAddress, isPublicHttpUrl } from '@oln/application';

const MAX_REDIRECTS = 5;

async function publicLookup(hostname: string): Promise<{ address: string; family: number }> {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((item) => isPrivateAddress(item.address))) {
    throw new Error('Capture target resolves to a private address.');
  }
  const first = addresses[0];
  if (!first) throw new Error('Capture target did not resolve.');
  return { address: first.address, family: first.family };
}

function requestOnce(
  url: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<CaptureResource & { location?: string; status: number }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('The capture was aborted.'));
      return;
    }
    const parsed = new URL(url);
    if (!isPublicHttpUrl(parsed.toString())) {
      reject(new Error('Capture target is not a public http(s) URL.'));
      return;
    }
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
    const lookupFn: LookupFunction = (_hostname, _options, callback) => {
      publicLookup(hostname)
        .then((result) => callback(null, result.address, result.family))
        .catch((error: Error) => callback(error, '', 0));
    };
    const request = (parsed.protocol === 'https:' ? httpsRequest : httpRequest)(
      {
        protocol: parsed.protocol,
        hostname,
        port: parsed.port || undefined,
        path: `${parsed.pathname}${parsed.search}`,
        method: 'GET',
        headers: {
          accept: 'text/html,application/xhtml+xml,image/png,image/jpeg,image/gif,image/webp',
          'accept-encoding': 'identity',
          'user-agent': 'OneLastNoteCapture/1.0 (+https://one-last-note.dev)',
        },
        lookup: lookupFn,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const location = response.headers.location;
        if (status >= 300 && status < 400 && location) {
          response.resume();
          resolve({
            status,
            url,
            contentType: '',
            bytes: new Uint8Array(),
            location: new URL(location, url).toString(),
          });
          return;
        }
        if (status < 200 || status >= 300) {
          response.resume();
          reject(new Error(`The page returned HTTP ${status}.`));
          return;
        }
        const chunks: Uint8Array[] = [];
        let length = 0;
        response.on('data', (chunk: Buffer) => {
          length += chunk.length;
          if (length > 12 * 1024 * 1024) {
            request.destroy(new Error('The page is too large to capture.'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          resolve({
            status,
            url,
            contentType: String(response.headers['content-type'] ?? 'application/octet-stream'),
            bytes: Buffer.concat(chunks),
          });
        });
      },
    );
    const onAbort = () => request.destroy(new Error('The capture was aborted.'));
    signal?.addEventListener('abort', onAbort, { once: true });
    request.setTimeout(timeoutMs, () =>
      request.destroy(new Error('The page took too long to load.')),
    );
    request.on('error', reject);
    request.on('close', () => signal?.removeEventListener('abort', onAbort));
    request.end();
  });
}

export function createSafeFetcher(timeoutMs = 20_000): CaptureFetcher {
  return {
    async fetch(input, signal) {
      let current = input;
      for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
        if (!isPublicHttpUrl(current)) {
          throw new Error('Capture target is not a public http(s) URL.');
        }
        const result = await requestOnce(current, timeoutMs, signal);
        if (!result.location) {
          return {
            url: result.url,
            contentType: result.contentType,
            bytes: result.bytes,
          };
        }
        current = result.location;
      }
      throw new Error('The page redirected too many times.');
    },
  };
}
