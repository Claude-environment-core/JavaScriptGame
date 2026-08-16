/**
 * The formation's spine: the path its anchor has actually travelled.
 *
 * A rigid virtual structure places trailing slots straight back along the
 * heading, which puts them inside walls the moment the route turns — and a slot
 * inside a wall is a slot no agent can hold. Placing them back along the
 * anchor's own trail instead means every slot sits in space the anchor has
 * already proved to be free, and a file bends around corners the way a queue of
 * people does.
 *
 * Slots are therefore expressed in trail coordinates:
 *
 *   longitudinal offset → arc length back along the trail
 *   lateral offset      → perpendicular to the trail's tangent at that point
 *
 * On a straight trail this is exactly the rigid placement it replaces.
 */

import { add, clone, distance, normalize, scale, subtract } from "../vec2.js";

/** Trail points closer together than this are not worth storing. */
const MIN_STEP = 0.08;

/** Step size when feeling backwards for the edge of free space. */
const EXTRAPOLATION_STEP = 0.2;

export class AnchorTrail {
  constructor(anchor, maxLength = 12, map = null) {
    this.maxLength = maxLength;
    this.map = map;
    this.points = [clone(anchor)];
    this.length = 0;
  }

  get head() {
    return this.points[0];
  }

  /**
   * Records the anchor's new position at the head of the trail, discarding
   * history beyond the length the formation can use.
   */
  push(anchor) {
    const step = distance(anchor, this.points[0]);

    if (step < MIN_STEP) {
      // Keep the head exact so slots do not lag the anchor by up to MIN_STEP.
      this.points[0] = clone(anchor);
      return;
    }

    this.points.unshift(clone(anchor));
    this.length += step;

    while (this.points.length > 2 && this.length > this.maxLength) {
      const last = this.points.length - 1;
      this.length -= distance(this.points[last], this.points[last - 1]);
      this.points.pop();
    }
  }

  /**
   * Point and heading a given arc length back along the trail.
   *
   * Distances beyond the recorded trail extrapolate backwards along its oldest
   * heading, so a formation longer than its history still gets sane slots.
   *
   * @param {number} back arc length behind the head; negative looks ahead.
   * @param {{x: number, y: number}} forward heading used ahead of the head
   */
  sample(back, forward) {
    if (back <= 0) {
      return { point: add(this.head, scale(forward, -back)), tangent: clone(forward) };
    }

    let travelled = 0;

    for (let i = 0; i < this.points.length - 1; i += 1) {
      const from = this.points[i];
      const to = this.points[i + 1];
      const segment = distance(from, to);

      if (segment <= 1e-9) {
        continue;
      }

      if (travelled + segment >= back) {
        const t = (back - travelled) / segment;
        return {
          point: add(from, scale(subtract(to, from), t)),
          // Tangent points the way the anchor was travelling, i.e. head-wards.
          tangent: normalize(subtract(from, to)),
        };
      }

      travelled += segment;
    }

    // Older than anything recorded — a squad that has not moved yet, or one
    // longer than its own history. Extrapolate along the oldest heading, but
    // only as far as free space allows: a spine that leaves the map takes every
    // slot hanging off it along.
    const oldest = this.points[this.points.length - 1];
    const tangent =
      this.points.length > 1
        ? normalize(subtract(this.points[this.points.length - 2], oldest))
        : clone(forward);

    return { point: this.extrapolate(oldest, tangent, back - travelled), tangent };
  }

  extrapolate(from, tangent, distanceBack) {
    if (!this.map) {
      return add(from, scale(tangent, -distanceBack));
    }

    let reached = from;

    for (let step = EXTRAPOLATION_STEP; step <= distanceBack; step += EXTRAPOLATION_STEP) {
      const candidate = add(from, scale(tangent, -step));

      if (!this.map.isWalkableWorld(candidate)) {
        return reached;
      }

      reached = candidate;
    }

    const full = add(from, scale(tangent, -distanceBack));
    return this.map.isWalkableWorld(full) ? full : reached;
  }
}
