import { describe, expect, it } from 'vitest';
import { reanchorText } from './annotations';

const anchor = {
  kind: 'text' as const,
  exact: 'shared phrase',
  prefix: 'The ',
  suffix: ' stays',
  startOffset: 0,
  endOffset: 13,
  path: 'body:nth-child(1)',
};

describe('reanchorText', () => {
  it('moves a unique context match to the new offsets', () => {
    expect(reanchorText(anchor, 'Intro. The shared phrase stays here.')).toMatchObject({
      startOffset: 11,
      endOffset: 24,
    });
  });

  it('refuses to guess when the same passage appears more than once', () => {
    expect(reanchorText(anchor, 'The shared phrase stays. The shared phrase stays.')).toBeNull();
  });

  it('uses context to disambiguate a repeated passage', () => {
    expect(reanchorText(anchor, 'A shared phrase moved. The shared phrase stays.')).toMatchObject({
      startOffset: 27,
    });
  });

  it('refuses a bare exact match when the saved context no longer agrees', () => {
    expect(reanchorText(anchor, 'A shared phrase stays.')).toBeNull();
  });

  it('does not re-anchor a PDF region', () => {
    expect(
      reanchorText(
        { kind: 'pdf', page: 2, rect: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 } },
        'shared phrase',
      ),
    ).toBeNull();
  });
});
