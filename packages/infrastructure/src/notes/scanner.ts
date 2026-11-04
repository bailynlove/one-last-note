import net from 'node:net';
import type { MalwareScanner, NoteStorage } from '@oln/application';
import type { ObjectStorage } from '../storage/client';

export function storageAdapter(storage: ObjectStorage): NoteStorage {
  return {
    put: (key, bytes, contentType) => storage.putObject(key, bytes, contentType),
    get: (key) => storage.getObject(key),
    delete: (key) => storage.deleteObject(key),
  };
}

export function createClamAvScanner(options: {
  host: string;
  port: number;
  timeoutMs?: number;
}): MalwareScanner {
  const timeoutMs = options.timeoutMs ?? 60_000;

  return {
    scan(bytes) {
      return new Promise((resolve, reject) => {
        const socket = new net.Socket();
        const chunks: Buffer[] = [];
        let settled = false;
        const finish = (error: Error | null, result?: { clean: boolean; detail?: string }) => {
          if (settled) {
            return;
          }
          settled = true;
          socket.destroy();
          if (error) {
            reject(error);
          } else if (result) {
            resolve(result);
          }
        };

        socket.setTimeout(timeoutMs, () => finish(new Error('ClamAV scan timed out')));
        socket.on('error', (error) => finish(error));
        socket.on('data', (data) => chunks.push(Buffer.from(data)));
        socket.on('end', () => {
          const response = Buffer.concat(chunks).toString('utf8').replaceAll('\0', '').trim();
          finish(null, {
            clean: response.endsWith('OK') && !response.includes('FOUND'),
            detail: response || 'empty scanner response',
          });
        });
        socket.connect(options.port, options.host, () => {
          socket.write('zINSTREAM\0');
          for (let offset = 0; offset < bytes.length; offset += 65_536) {
            const chunk = bytes.subarray(offset, offset + 65_536);
            const length = Buffer.alloc(4);
            length.writeUInt32BE(chunk.length);
            socket.write(length);
            socket.write(chunk);
          }
          socket.write(Buffer.from([0, 0, 0, 0]));
        });
      });
    },
  };
}

export function createDevelopmentScanner(): MalwareScanner {
  return {
    async scan() {
      return { clean: true, detail: 'scanner disabled in development' };
    },
  };
}
