import type { RelationGraph } from '@oln/domain';
import { describe, expect, it } from 'vitest';
import { buildDisplayGraph, circlePositions } from './relation-layout';

function graph(count: number, edges: [number, number][]): RelationGraph {
  const notes = Array.from({ length: count }, (_, index) => ({
    id: `note-${String(index).padStart(3, '0')}`,
    title: `Note ${String(index).padStart(3, '0')}`,
    currentRevisionId: null,
    revisions: [],
  }));
  return {
    knowledgeBaseId: 'kb',
    notes,
    relations: edges.map(([source, target], index) => ({
      id: `rel-${index}`,
      knowledgeBaseId: 'kb',
      type: 'related',
      origin: 'manual',
      sourceNoteId: notes[source]?.id ?? '',
      targetNoteId: notes[target]?.id ?? '',
      createdByUserId: 'user',
      createdByDisplayName: 'User',
      createdAt: '2026-01-01T00:00:00.000Z',
    })),
    references: [],
    revision: 'current',
    truncated: false,
  };
}

describe('relation layout', () => {
  it('keeps small graphs unclustered and deterministic', () => {
    const input = graph(4, [
      [0, 1],
      [2, 3],
    ]);
    const first = buildDisplayGraph(input);
    const second = buildDisplayGraph(input);
    expect(first.nodes.map((node) => node.id)).toEqual([
      'note-000',
      'note-001',
      'note-002',
      'note-003',
    ]);
    expect(first.edges).toHaveLength(2);
    expect(second).toEqual(first);
    expect([...circlePositions(first.nodes).keys()]).toEqual([
      'note-000',
      'note-001',
      'note-002',
      'note-003',
    ]);
  });

  it('collapses a mixed-family component', () => {
    const edges: [number, number][] = [];
    for (let index = 0; index < 40; index += 1) edges.push([index, index + 1]);
    const mixed = graph(45, edges);
    mixed.references.push({
      id: 'mixed-reference',
      knowledgeBaseId: 'kb',
      type: 'references',
      origin: 'content',
      sourceNoteId: 'note-000',
      targetNoteId: 'note-020',
      sourceRevisionId: 'revision',
      sourceRevisionNumber: 1,
      path: '/notes/note-020',
      context: 'mixed',
    });
    const result = buildDisplayGraph(mixed);
    expect(result.nodes.some((node) => node.kind === 'cluster')).toBe(true);
    const cluster = result.nodes.find((node) => node.kind === 'cluster');
    const expanded = buildDisplayGraph(mixed, new Set([cluster?.id ?? '']));
    expect(expanded.nodes).toHaveLength(45);
  });

  it('collapses large connected components but keeps isolated Notes visible', () => {
    const edges: [number, number][] = [];
    for (let index = 0; index < 40; index += 1) {
      edges.push([index, index + 1]);
    }
    const input = graph(45, edges);
    const collapsed = buildDisplayGraph(input);
    expect(collapsed.nodes.filter((node) => node.kind === 'cluster')).toHaveLength(1);
    expect(collapsed.nodes.filter((node) => node.kind === 'note')).toHaveLength(4);
    expect(collapsed.clusters[0]?.count).toBe(41);

    const expanded = buildDisplayGraph(input, new Set([collapsed.clusters[0]?.id ?? '']));
    expect(expanded.nodes.some((node) => node.kind === 'cluster')).toBe(false);
    expect(expanded.nodes).toHaveLength(45);
    const before = circlePositions(collapsed.nodes);
    const after = circlePositions(expanded.nodes);
    for (const node of collapsed.nodes.filter((item) => item.kind === 'note')) {
      expect(after.get(node.id)).toEqual(before.get(node.id));
    }
  });
});
