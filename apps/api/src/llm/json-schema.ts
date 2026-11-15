import { z } from 'zod';

type Json = Record<string, unknown>;

/** Keywords removed from the wire schema; the full zod schema still validates them after the response. */
const DROP = new Set(['$schema', 'minLength', 'maxLength', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'pattern', 'format', 'minItems', 'maxItems', 'default']);

function sanitize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitize);
  if (!node || typeof node !== 'object') return node;
  const out: Json = {};
  for (const [k, v] of Object.entries(node as Json)) {
    if (DROP.has(k)) continue;
    out[k] = sanitize(v);
  }
  if (out.type === 'object' && out.properties && typeof out.properties === 'object') {
    // Structured outputs require closed objects with every property listed as required.
    out.additionalProperties = false;
    out.required = Object.keys(out.properties);
  }
  return out;
}

/**
 * JSON schema for `output_config.format` derived from a zod schema: closed objects, all properties required, and
 * value constraints stripped (they are enforced by zod after parsing, so the model can't silently skip them).
 */
export function toWireSchema(schema: z.ZodType): Json {
  return sanitize(z.toJSONSchema(schema, { io: 'output', unrepresentable: 'any' })) as Json;
}
