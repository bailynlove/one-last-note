import type { MarkTypeDescriptor } from '@oln/domain';
import { BUILTIN_MARK_TYPES } from '@oln/domain';

export interface MarkTypeReader {
  markTypes(userId: string, knowledgeBaseId: string): Promise<MarkTypeDescriptor[]>;
}

type Schema = {
  type?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean;
  enum?: unknown[];
  maxLength?: number;
  maxItems?: number;
  items?: Schema;
  minimum?: number;
  maximum?: number;
};

const MAX_PAYLOAD_BYTES = 10_000;

function valueMatches(value: unknown, schema: Schema): boolean {
  if (schema.enum && !schema.enum.some((item) => Object.is(item, value))) return false;
  switch (schema.type) {
    case 'string':
      return (
        typeof value === 'string' &&
        (schema.maxLength === undefined || value.length <= schema.maxLength)
      );
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return (
        Array.isArray(value) && (schema.maxItems === undefined || value.length <= schema.maxItems)
      );
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'null':
      return value === null;
    default:
      return true;
  }
}

function validateAt(value: unknown, schema: Schema, depth = 0): string | null {
  if (depth > 6) return 'Mark payload is nested too deeply.';
  if (!valueMatches(value, schema)) return 'Mark payload does not match the schema.';
  if (schema.type === 'number' || schema.type === 'integer') {
    const number = value as number;
    if (schema.minimum !== undefined && number < schema.minimum)
      return 'Mark payload is too small.';
    if (schema.maximum !== undefined && number > schema.maximum)
      return 'Mark payload is too large.';
  }
  if (schema.type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in object)) return `Mark payload is missing ${key}.`;
    }
    const properties = schema.properties ?? {};
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(object)) {
        if (!(key in properties)) return `Mark payload has an unknown field: ${key}.`;
      }
    }
    for (const [key, child] of Object.entries(properties)) {
      if (key in object) {
        const error = validateAt(object[key], child, depth + 1);
        if (error) return error;
      }
    }
  }
  if (schema.type === 'array' && Array.isArray(value) && schema.items) {
    for (const item of value) {
      const error = validateAt(item, schema.items as Schema, depth + 1);
      if (error) return error;
    }
  }
  return null;
}

export function validateMarkPayload(
  definition: MarkTypeDescriptor,
  payload: Record<string, unknown>,
): string | null {
  if (JSON.stringify(payload).length > MAX_PAYLOAD_BYTES) return 'Mark payload is too large.';
  return validateAt(payload, definition.schema as Schema);
}

export function markTypesFor(extensionMarks: MarkTypeDescriptor[]): MarkTypeDescriptor[] {
  return [...BUILTIN_MARK_TYPES, ...extensionMarks];
}
