/**
 * Canonical JSON serialization for `content/*.json`.
 *
 * Any tool that writes content files must use this so saves are deterministic and git
 * diffs stay reviewable: object keys in a stable order, 2-space indent, trailing newline.
 * Array order is preserved — ordering is meaningful in content (levelUpTraitOrder,
 * security stacks, omega stages).
 */

/** Keys emitted first, in this order; all other keys follow alphabetically. */
const PREFERRED_KEY_ORDER = [
  "id",
  "kind",
  "name",
  "type",
  "description",
  "cardArt",
] as const;

const preferredIndex = new Map<string, number>(
  PREFERRED_KEY_ORDER.map((k, i) => [k, i] as const),
);

function compareKeys(a: string, b: string): number {
  const ia = preferredIndex.get(a);
  const ib = preferredIndex.get(b);
  if (ia !== undefined && ib !== undefined) {
    return ia - ib;
  }
  if (ia !== undefined) {
    return -1;
  }
  if (ib !== undefined) {
    return 1;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort(compareKeys)) {
      const v = src[key];
      if (v === undefined) {
        continue;
      }
      out[key] = canonicalize(v);
    }
    return out;
  }
  return value;
}

/**
 * Deterministic JSON text for one content slice (or any content-shaped value).
 * Same value in ⇒ byte-identical text out, regardless of input key order.
 */
export function serializeContentSlice(data: unknown): string {
  return `${JSON.stringify(canonicalize(data), null, 2)}\n`;
}
