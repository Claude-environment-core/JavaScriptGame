/**
 * Deterministic pseudo random number generator.
 *
 * World generation is parity critical, so the generator is defined here in full
 * rather than borrowed from the host runtime: given the same seed and the same
 * call order it always yields the same stream, on every JavaScript engine.
 *
 * Algorithm: mulberry32 (32-bit state, single multiply-xor-shift round).
 */
export class DeterministicRandom {
  constructor(seed = 0) {
    this.seed = seed >>> 0;
    this.state = this.seed;
  }

  /** Restarts the stream from the original seed. */
  reset() {
    this.state = this.seed;
  }

  /** Uniform float in `[0, 1)`. */
  nextFloat() {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform integer in `[minInclusive, maxExclusive)`. */
  nextInt(minInclusive, maxExclusive) {
    if (maxExclusive <= minInclusive) {
      return minInclusive;
    }

    return minInclusive + Math.floor(this.nextFloat() * (maxExclusive - minInclusive));
  }

  /** Uniform float in `[min, max)`. */
  nextRange(min, max) {
    return min + this.nextFloat() * (max - min);
  }
}
