import { describe, expect, it } from 'vitest';
import { inspectOriginal, UploadValidationError } from './notes';

const encoder = new TextEncoder();

function errorCode(run: () => unknown): string {
  try {
    run();
    return 'none';
  } catch (error) {
    if (error instanceof UploadValidationError) {
      return error.code;
    }
    throw error;
  }
}

describe('inspectOriginal', () => {
  it('accepts supported originals with matching signatures', () => {
    expect(
      inspectOriginal('paper.pdf', 'application/pdf', encoder.encode('%PDF-1.7\nbody')),
    ).toEqual({
      mediaType: 'application/pdf',
      extension: 'pdf',
      signature: 'pdf',
    });
    expect(inspectOriginal('notes.md', 'text/markdown', encoder.encode('# Heading\ntext'))).toEqual(
      { mediaType: 'text/markdown', extension: 'md', signature: 'text' },
    );
  });

  it('rejects empty and oversized originals', () => {
    expect(errorCode(() => inspectOriginal('empty.pdf', 'application/pdf', new Uint8Array()))).toBe(
      'empty_file',
    );
    expect(
      errorCode(() =>
        inspectOriginal('large.pdf', 'application/pdf', encoder.encode('%PDF-1.7\nbody'), 4),
      ),
    ).toBe('file_too_large');
  });

  it('rejects archives before inspecting their content', () => {
    expect(
      errorCode(() =>
        inspectOriginal('bundle.zip', 'application/zip', encoder.encode('PK\u0003\u0004')),
      ),
    ).toBe('archive_not_allowed');
    expect(
      errorCode(() =>
        inspectOriginal('report.docx', 'application/pdf', encoder.encode('PK\u0003\u0004')),
      ),
    ).toBe('archive_not_allowed');
  });

  it('rejects unsupported types, mismatches, and encrypted PDFs', () => {
    expect(
      errorCode(() =>
        inspectOriginal('script.exe', 'application/octet-stream', encoder.encode('MZ')),
      ),
    ).toBe('unsupported_type');
    expect(
      errorCode(() => inspectOriginal('paper.pdf', 'text/plain', encoder.encode('%PDF-1.7'))),
    ).toBe('mime_mismatch');
    expect(
      errorCode(() => inspectOriginal('paper.pdf', 'application/pdf', encoder.encode('not a pdf'))),
    ).toBe('signature_mismatch');
    expect(
      errorCode(() =>
        inspectOriginal(
          'locked.pdf',
          'application/pdf',
          encoder.encode('%PDF-1.7\n1 0 obj\n<< /Encrypt 2 >>\nendobj'),
        ),
      ),
    ).toBe('encrypted_pdf');
  });

  it('rejects binaries with text extensions and invalid UTF-8', () => {
    expect(
      errorCode(() => inspectOriginal('notes.md', 'text/markdown', encoder.encode('\u0000\u0001'))),
    ).toBe('invalid_text');
    expect(
      errorCode(() =>
        inspectOriginal('notes.txt', 'text/plain', new Uint8Array([0xff, 0xfe, 0xfd])),
      ),
    ).toBe('invalid_text');
  });
});
