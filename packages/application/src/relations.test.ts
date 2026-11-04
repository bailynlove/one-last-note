import { describe, expect, it } from 'vitest';
import { extractContentReferences } from './relations';

const source = '11111111-1111-4111-8111-111111111111';
const target = '22222222-2222-4222-8222-222222222222';
const other = '33333333-3333-4333-8333-333333333333';

describe('content reference extraction', () => {
  it('keeps same-Knowledge-Base app links, excludes self/external links, and dedupes paths', () => {
    const text = `<p><a href="/notes/${target}">Target</a> <a href="http://localhost:3000/notes/${target}">Again</a> <a href="/notes/${source}">Self</a> <a href="https://example.com/notes/${other}">Other origin</a></p>`;
    const refs = extractContentReferences({
      knowledgeBaseId: 'kb',
      sourceNoteId: source,
      sourceRevisionId: 'rev',
      sourceRevisionNumber: 2,
      text,
      targetNoteIds: new Set([source, target, other]),
      webAppUrl: 'http://localhost:3000',
    });
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      targetNoteId: target,
      sourceRevisionId: 'rev',
      sourceRevisionNumber: 2,
      path: `/notes/${target}`,
    });
    expect(refs[0]?.context).toContain('Target');
  });

  it('reads Markdown links but ignores code blocks and plain URLs', () => {
    const text = `[Target](/notes/${target}) [Again](/notes/${target}) \`[Code](/notes/${other})\`\n\n\`\`\`\n[Fake](/notes/${other})\n\`\`\`\nhttps://example.com/notes/${other}`;
    const refs = extractContentReferences({
      knowledgeBaseId: 'kb',
      sourceNoteId: source,
      sourceRevisionId: 'rev',
      sourceRevisionNumber: 3,
      text,
      targetNoteIds: new Set([target, other]),
      webAppUrl: 'http://localhost:3000',
    });
    expect(refs).toHaveLength(1);
    expect(refs[0]?.targetNoteId).toBe(target);
    expect(refs[0]?.sourceRevisionNumber).toBe(3);
  });

  it('ignores targets outside the Knowledge Base and resigns gracefully with none', () => {
    expect(
      extractContentReferences({
        knowledgeBaseId: 'kb',
        sourceNoteId: source,
        sourceRevisionId: 'rev',
        sourceRevisionNumber: 1,
        text: `<a href="/notes/${target}">Outside</a>`,
        targetNoteIds: new Set([source]),
        webAppUrl: 'http://localhost:3000',
      }),
    ).toEqual([]);
  });
});
