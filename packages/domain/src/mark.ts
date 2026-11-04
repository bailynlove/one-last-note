import { HIGHLIGHT_MARK_TYPE } from './annotation';

export interface MarkDefinition {
  type: string;
  label: string;
  description: string;
  schema: Record<string, unknown>;
  defaultPayload: Record<string, unknown>;
}

export interface MarkTypeDescriptor extends MarkDefinition {
  source: 'builtin' | 'extension';
  extensionId: string | null;
  extensionVersion: string | null;
  operations: string[];
}

export const BUILTIN_MARK_TYPES: MarkTypeDescriptor[] = [
  {
    type: HIGHLIGHT_MARK_TYPE,
    label: 'Highlight',
    description: 'A highlighted passage with no additional fields.',
    schema: { type: 'object', additionalProperties: false, properties: {} },
    defaultPayload: {},
    source: 'builtin',
    extensionId: null,
    extensionVersion: 'core',
    operations: ['create', 'list'],
  },
];
