import type { RelationGraph } from '@oln/domain';
import { RELATION_LABELS } from '@oln/domain';

export type RelationFamily = 'related' | 'references' | 'supersedes' | 'content';

export interface DisplayNode {
  id: string;
  label: string;
  noteIds: string[];
  kind: 'note' | 'cluster';
  count: number;
  family?: RelationFamily;
}

export interface DisplayEdge {
  source: string;
  target: string;
  type: string;
  origin: 'manual' | 'content';
  family: RelationFamily;
  directed: boolean;
  label: string;
  count: number;
}

const CLUSTER_THRESHOLD = 40;

function components(noteIds: string[], edges: { source: string; target: string }[]) {
  const parent = new Map(noteIds.map((id) => [id, id]));
  const find = (id: string): string => {
    const current = parent.get(id) ?? id;
    if (current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  for (const edge of edges) {
    const a = find(edge.source);
    const b = find(edge.target);
    if (a !== b) parent.set(a, b);
  }
  return find;
}

export function buildDisplayGraph(
  graph: RelationGraph,
  expandedClusters: ReadonlySet<string> = new Set(),
): { nodes: DisplayNode[]; edges: DisplayEdge[]; clusters: DisplayNode[] } {
  const noteIds = graph.notes.map((note) => note.id);
  const allEdges = [
    ...graph.relations.map((relation) => ({
      source: relation.sourceNoteId,
      target: relation.targetNoteId,
      type: relation.type,
      origin: 'manual' as const,
      family: relation.type as RelationFamily,
    })),
    ...graph.references.map((reference) => ({
      source: reference.sourceNoteId,
      target: reference.targetNoteId,
      type: 'references' as const,
      origin: 'content' as const,
      family: 'content' as const,
    })),
  ];
  const find = components(noteIds, allEdges);
  const members = new Map<string, string[]>();
  for (const note of graph.notes) {
    const root = find(note.id);
    members.set(root, [...(members.get(root) ?? []), note.id]);
  }
  const clusterFor = new Map<string, string>();
  const clusters: DisplayNode[] = [];
  const familyLabels: Record<RelationFamily, string> = {
    related: 'Related to',
    references: 'References',
    supersedes: 'Supersedes',
    content: 'Content references',
  };
  if (graph.notes.length > CLUSTER_THRESHOLD) {
    for (const [root, ids] of [...members.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (ids.length < 2) continue;
      const id = `cluster:${[...ids].sort()[0] ?? root}`;
      if (expandedClusters.has(id)) continue;
      const memberIds = new Set(ids);
      const families = new Set(
        allEdges
          .filter((edge) => memberIds.has(edge.source) && memberIds.has(edge.target))
          .map((edge) => edge.family),
      );
      const family = families.size === 1 ? ([...families][0] as RelationFamily) : undefined;
      clusters.push({
        id,
        label: `${ids.length} Notes · ${family ? familyLabels[family] : 'Mixed relations'}`,
        noteIds: [...ids].sort(),
        kind: 'cluster',
        count: ids.length,
        ...(family ? { family } : {}),
      });
      for (const noteId of ids) clusterFor.set(noteId, id);
    }
  }
  const nodes: DisplayNode[] = [
    ...graph.notes
      .filter((note) => !clusterFor.has(note.id))
      .map((note) => ({
        id: note.id,
        label: note.title,
        noteIds: [note.id],
        kind: 'note' as const,
        count: 1,
      })),
    ...clusters,
  ].sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));

  const merged = new Map<string, DisplayEdge>();
  for (const edge of allEdges) {
    const source = clusterFor.get(edge.source) ?? edge.source;
    const target = clusterFor.get(edge.target) ?? edge.target;
    if (source === target) continue;
    const key = [source, target, edge.type, edge.origin, edge.family].join('|');
    const existing = merged.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    merged.set(key, {
      source,
      target,
      type: edge.type,
      origin: edge.origin,
      family: edge.family,
      directed: edge.type !== 'related',
      label:
        edge.origin === 'content'
          ? 'Content reference'
          : (RELATION_LABELS[edge.type as keyof typeof RELATION_LABELS] ?? edge.type),
      count: 1,
    });
  }
  return {
    nodes,
    clusters,
    edges: [...merged.values()].sort(
      (a, b) =>
        a.source.localeCompare(b.source) ||
        a.target.localeCompare(b.target) ||
        a.type.localeCompare(b.type) ||
        a.family.localeCompare(b.family),
    ),
  };
}

export function circlePositions(
  nodes: DisplayNode[],
  width = 900,
  height = 620,
): Map<string, { x: number; y: number }> {
  const radius = Math.min(width, height) / 2 - 90;
  const centerX = width / 2;
  const centerY = height / 2;
  const positions = new Map<string, { x: number; y: number }>();
  for (const node of nodes) {
    const hash = hashString(node.id);
    const angle = ((hash % 3600) / 3600) * Math.PI * 2;
    const ring = radius * (0.58 + ((hash >>> 12) % 42) / 100);
    positions.set(node.id, {
      x: centerX + Math.cos(angle) * ring,
      y: centerY + Math.sin(angle) * ring,
    });
  }
  return positions;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  }
  return hash >>> 0;
}
