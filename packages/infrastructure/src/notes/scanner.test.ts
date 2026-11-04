import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createClamAvScanner } from './scanner';

const servers: net.Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))),
  );
});

async function scannerFor(response: string) {
  const server = net.createServer((socket) => {
    socket.once('data', () => socket.end(response));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('test server did not bind');
  }
  return createClamAvScanner({ host: '127.0.0.1', port: address.port, timeoutMs: 2_000 });
}

describe('ClamAV scanner', () => {
  it('accepts a clean NUL-terminated response', async () => {
    const scanner = await scannerFor('stream: OK\0');
    await expect(scanner.scan(new Uint8Array([1, 2, 3]), 'application/pdf')).resolves.toMatchObject(
      { clean: true },
    );
  });

  it('rejects an infected response', async () => {
    const scanner = await scannerFor('stream: Eicar-Test-Signature FOUND\0');
    await expect(scanner.scan(new Uint8Array([1, 2, 3]), 'application/pdf')).resolves.toMatchObject(
      {
        clean: false,
      },
    );
  });
});
