'use client';

import { useMemo, useRef, useState } from 'react';
import type { DisplayEdge, DisplayNode } from '../lib/relation-layout';
import { circlePositions } from '../lib/relation-layout';
import styles from './relation-graph.module.css';

interface RelationGraphProps {
  notes: DisplayNode[];
  edges: DisplayEdge[];
  selectedNoteId: string | null;
  search: Record<string, string>;
}

const WIDTH = 900;
const HEIGHT = 620;

const edgeClass: Record<string, string | undefined> = {
  related: styles.edgeRelated,
  references: styles.edgeReferences,
  supersedes: styles.edgeSupersedes,
  content: styles.contentEdge,
};

export function RelationGraph({ notes, edges, selectedNoteId, search }: RelationGraphProps) {
  const positions = useMemo(() => circlePositions(notes, WIDTH, HEIGHT), [notes]);
  const neighbors = useMemo(() => {
    const set = new Set<string>();
    if (!selectedNoteId) return set;
    set.add(selectedNoteId);
    for (const edge of edges) {
      if (edge.source === selectedNoteId) set.add(edge.target);
      if (edge.target === selectedNoteId) set.add(edge.source);
    }
    return set;
  }, [edges, selectedNoteId]);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  function hrefFor(node: DisplayNode): string {
    const params = new URLSearchParams(search);
    params.delete('error');
    params.set('note', node.id);
    params.delete('error');
    return `?${params.toString()}`;
  }

  return (
    <div className={styles.graphWrap}>
      <fieldset className={styles.controls} aria-label="Graph controls">
        <button type="button" onClick={() => setZoom((value) => Math.min(2, value + 0.15))}>
          Zoom in
        </button>
        <button type="button" onClick={() => setZoom((value) => Math.max(0.5, value - 0.15))}>
          Zoom out
        </button>
        <button
          type="button"
          onClick={() => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}
        >
          Fit
        </button>
        <span className={styles.hint}>Drag to pan · Tab to Notes · Enter to inspect</span>
      </fieldset>
      <svg
        className={styles.graph}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        aria-label="Note relation graph"
        onPointerDown={(event) => {
          if ((event.target as Element).closest('a')) return;
          drag.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          setPan({
            x: drag.current.panX + event.clientX - drag.current.x,
            y: drag.current.panY + event.clientY - drag.current.y,
          });
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
      >
        <defs>
          <marker
            id="relation-arrow"
            markerWidth="8"
            markerHeight="8"
            refX="8"
            refY="4"
            orient="auto"
          >
            <path d="M0,0 L8,4 L0,8 Z" fill="currentColor" />
          </marker>
        </defs>
        <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
          {edges.map((edge) => {
            const source = positions.get(edge.source);
            const target = positions.get(edge.target);
            if (!source || !target) return null;
            return (
              <g key={`${edge.source}-${edge.target}-${edge.type}-${edge.origin}-${edge.family}`}>
                <line
                  className={`${styles.edge} ${edgeClass[edge.family] ?? ''} ${
                    selectedNoteId && !(neighbors.has(edge.source) && neighbors.has(edge.target))
                      ? styles.edgeDim
                      : ''
                  }`}
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                  markerEnd={edge.directed ? 'url(#relation-arrow)' : undefined}
                />
                <title>
                  {edge.label}
                  {edge.count > 1 ? ` × ${edge.count}` : ''}
                </title>
              </g>
            );
          })}
          {notes.map((node) => {
            const position = positions.get(node.id);
            if (!position) return null;
            const selected = node.id === selectedNoteId;
            return (
              <a
                key={node.id}
                href={hrefFor(node)}
                className={styles.nodeLink}
                aria-label={
                  node.kind === 'cluster'
                    ? `Inspect cluster of ${node.count} Notes`
                    : `${node.label}${selected ? ', selected' : ''}`
                }
              >
                <circle
                  className={`${styles.node} ${node.kind === 'cluster' ? styles.cluster : ''} ${
                    selected ? styles.selected : ''
                  }`}
                  cx={position.x}
                  cy={position.y}
                  r={node.kind === 'cluster' ? 30 : 20}
                />
                <text
                  className={styles.nodeLabel}
                  x={position.x}
                  y={position.y + (node.kind === 'cluster' ? 42 : 34)}
                  textAnchor="middle"
                >
                  {node.label.length > 28 ? `${node.label.slice(0, 27)}…` : node.label}
                </text>
              </a>
            );
          })}
        </g>
      </svg>
      <ul className={styles.legend} aria-label="Legend">
        <li>
          <span className={`${styles.legendLine} ${styles.edgeRelated}`} /> Related to
        </li>
        <li>
          <span className={`${styles.legendLine} ${styles.edgeReferences}`} /> References
        </li>
        <li>
          <span className={`${styles.legendLine} ${styles.edgeSupersedes}`} /> Supersedes
        </li>
        <li>
          <span className={`${styles.legendLine} ${styles.legendDashed}`} /> Content reference
        </li>
        <li>Arrow = direction; clusters open their Notes.</li>
      </ul>
    </div>
  );
}
