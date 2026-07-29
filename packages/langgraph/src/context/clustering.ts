/**
 * Converts an embedding to a unit vector once, so the clustering loop can use a
 * plain dot product.
 *
 * The previous cosineDistance(a, b) recomputed BOTH vectors' norms on every
 * call — for an n-value role that is O(n^2) x 3 x 1536 multiplies plus two
 * square roots per pair. Normalizing up front is O(n), and makes each pair a
 * single 1536-multiply dot product.
 *
 * Float32Array, not number[]: pgvector's `vector` type is already float4, so
 * this loses no precision relative to what is stored, while roughly halving
 * memory and giving the inner loop contiguous, unboxed values.
 */
export function toUnitVector(values: ArrayLike<number>): Float32Array {
  const out = new Float32Array(values.length);
  let norm = 0;
  for (let i = 0; i < values.length; i++) norm += values[i] * values[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < values.length; i++) out[i] = values[i] / norm;
  return out;
}

/** Cosine distance between two vectors already passed through toUnitVector. */
export function unitCosineDistance(a: Float32Array, b: Float32Array): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < len; i++) dot += a[i] * b[i];
  return 1 - dot;
}

export class UnionFind {
  private parent = new Map<string, string>();

  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    let cur = x;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent.set(rootA, rootB);
  }
}
