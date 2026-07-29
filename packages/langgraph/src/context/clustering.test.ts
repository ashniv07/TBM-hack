import { describe, expect, it } from "vitest";
import { toUnitVector, unitCosineDistance, UnionFind } from "./clustering";

// The clustering threshold decides which raw values merge into one canonical
// entity, so the distance function has to stay numerically equivalent to the
// plain cosine distance it replaced.
function referenceCosineDistance(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 1;
  return 1 - dot / (Math.sqrt(na) * Math.sqrt(nb));
}

describe("unitCosineDistance", () => {
  it("matches the un-normalized reference implementation", () => {
    const a = [3, 0, 4], b = [1, 2, 2], c = [-1, 0, 0];
    for (const [x, y] of [[a, b], [a, c], [b, c], [a, a]] as const) {
      expect(unitCosineDistance(toUnitVector(x), toUnitVector(y)))
        .toBeCloseTo(referenceCosineDistance(x, y), 5);
    }
  });

  it("is scale-invariant — magnitude must not affect the merge decision", () => {
    const near = unitCosineDistance(toUnitVector([1, 2, 3]), toUnitVector([10, 20, 30]));
    expect(near).toBeCloseTo(0, 6);
  });

  it("returns 1 for an all-zero vector instead of NaN", () => {
    // A NaN here would silently compare false against the threshold and stop
    // every value in the role from merging.
    expect(unitCosineDistance(toUnitVector([0, 0, 0]), toUnitVector([1, 0, 0]))).toBe(1);
  });

  it("orthogonal is 1, opposite is 2", () => {
    expect(unitCosineDistance(toUnitVector([1, 0]), toUnitVector([0, 1]))).toBeCloseTo(1, 6);
    expect(unitCosineDistance(toUnitVector([1, 0]), toUnitVector([-1, 0]))).toBeCloseTo(2, 6);
  });
});

describe("UnionFind", () => {
  it("merges transitively so A~B and B~C put all three in one cluster", () => {
    const uf = new UnionFind();
    uf.union("a", "b");
    uf.union("b", "c");
    expect(uf.find("a")).toBe(uf.find("c"));
    expect(uf.find("d")).not.toBe(uf.find("a"));
  });
});
