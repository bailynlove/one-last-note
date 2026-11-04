import { describe, expect, it } from 'vitest';
import { createSafeFetcher } from './fetcher';

describe('safe capture fetcher', () => {
  it('rejects private and non-http targets before opening a connection', async () => {
    const fetcher = createSafeFetcher();
    await expect(fetcher.fetch('http://127.0.0.1/')).rejects.toThrow(/public http/);
    await expect(fetcher.fetch('http://localhost/')).rejects.toThrow(/public http/);
    await expect(fetcher.fetch('file:///etc/passwd')).rejects.toThrow(/public http/);
  });
});
