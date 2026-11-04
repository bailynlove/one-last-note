import { describe, expect, it } from 'vitest';
import { RateLimitError } from './errors';
import { NoteService, type NoteStore } from './notes';

describe('NoteService upload limits', () => {
  it('rejects when no active upload slot is available', async () => {
    let stored = false;
    const service = new NoteService({
      store: {} as NoteStore,
      storage: {
        put: async () => {
          stored = true;
        },
        get: async () => new Uint8Array(),
        delete: async () => {},
      },
      scanner: { scan: async () => ({ clean: true }) },
      acquireUploadSlot: async () => null,
    });
    await expect(
      service.upload('user', ['kb'], {
        filename: 'note.md',
        mediaType: 'text/markdown',
        bytes: new TextEncoder().encode('# hi'),
      }),
    ).rejects.toBeInstanceOf(RateLimitError);
    expect(stored).toBe(false);
  });

  it('rejects an over-limit upload before touching storage', async () => {
    let stored = false;
    const service = new NoteService({
      store: {} as NoteStore,
      storage: {
        put: async () => {
          stored = true;
        },
        get: async () => new Uint8Array(),
        delete: async () => {},
      },
      scanner: { scan: async () => ({ clean: true }) },
      uploadLimiter: async () => ({ allowed: false, retryAfterSeconds: 42 }),
    });
    await expect(
      service.upload('user', ['kb'], {
        filename: 'note.md',
        mediaType: 'text/markdown',
        bytes: new TextEncoder().encode('# hi'),
      }),
    ).rejects.toBeInstanceOf(RateLimitError);
    expect(stored).toBe(false);
  });
});
