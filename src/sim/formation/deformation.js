/**
 * The deformable virtual structure itself.
 *
 * The formation carries an affine transform applied to its nominal lattice:
 *
 *     slot_world(i) = anchor + R(forward) · D · offset(i) · spacing
 *
 *         ⎡ sx  0 ⎤
 *     D = ⎢       ⎥      sx = lateral scale, sy = longitudinal scale
 *         ⎣ 0  sy ⎦
 *
 * Narrowing preserves area — `sy = 1/sx` — so a formation that squeezes also
 * lengthens, and a wedge entering a corridor becomes a file continuously rather
 * than by special case.
 *
 * The narrowing floor is *derived*, never declared: it is the tightest lateral
 * scale at which no two slots come closer than the agents' personal space. That
 * derivation is what keeps the constraint layer silent inside a valid formation.
 */

import { add, rightOf, scale } from "../vec2.js";
import { personalSpace } from "./params.js";
import {
  FormationType,
  getDegradedType,
  getExtents,
  getMaxLongitudinalScale,
  getMinimumGap,
  getOffsets,
} from "./shape.js";

export const FormationMode = Object.freeze({
  Open: "Open",
  Squeeze: "Squeeze",
  File: "File",
});

const FLOOR_SEARCH_STEP = 0.01;

/** Deadband for the Open/Squeeze label, so a scale hovering at 1 does not flicker. */
const OPEN_ENTER = 0.98;
const OPEN_LEAVE = 0.92;

const latticeCache = new Map();

/** Longitudinal scale that preserves the lattice's area as it narrows. */
function longitudinalScale(scaleX, maxLongitudinal) {
  if (scaleX <= 0) {
    return maxLongitudinal;
  }

  return Math.min(Math.max(1 / scaleX, 1), maxLongitudinal);
}

/** Smallest distance between two slots of a lattice deformed by `scaleX`. */
function deformedMinimumGap(offsets, scaleX, maxLongitudinal, spacing) {
  const scaleY = longitudinalScale(scaleX, maxLongitudinal);
  let smallest = Infinity;

  for (let i = 0; i < offsets.length; i += 1) {
    for (let j = i + 1; j < offsets.length; j += 1) {
      const dx = (offsets[i].x - offsets[j].x) * scaleX * spacing;
      const dy = (offsets[i].y - offsets[j].y) * scaleY * spacing;
      smallest = Math.min(smallest, Math.hypot(dx, dy));
    }
  }

  return smallest;
}

/**
 * Tightest lateral scale whose deformed lattice still keeps every pair of slots
 * at least `minGap` apart. Searched rather than declared, so it stays correct
 * for any shape and any agent size.
 */
function deriveLateralFloor(offsets, maxLongitudinal, spacing, minGap) {
  if (offsets.length < 2 || deformedMinimumGap(offsets, 1, maxLongitudinal, spacing) < minGap) {
    // Either nothing can collide, or the nominal lattice is already too tight to
    // narrow at all — in both cases there is no room below 1.
    return 1;
  }

  let floor = 1;

  for (let scale = 1; scale > FLOOR_SEARCH_STEP; scale -= FLOOR_SEARCH_STEP) {
    if (deformedMinimumGap(offsets, scale, maxLongitudinal, spacing) < minGap) {
      break;
    }

    floor = scale;
  }

  return floor;
}

/**
 * Cached geometry for one (shape, count, spacing, personal space) combination.
 */
export function getLattice(type, count, params) {
  const minGap = personalSpace(params);
  const key = `${type}|${count}|${params.spacing}|${minGap}`;
  const cached = latticeCache.get(key);

  if (cached) {
    return cached;
  }

  const offsets = getOffsets(type, count);
  const maxLongitudinal = getMaxLongitudinalScale(type);
  const lattice = {
    type,
    offsets,
    maxLongitudinal,
    ...getExtents(offsets),
    nominalGap: getMinimumGap(offsets),
    lateralFloor: deriveLateralFloor(offsets, maxLongitudinal, params.spacing, minGap),
  };

  latticeCache.set(key, lattice);
  return lattice;
}

export class FormationDeformation {
  constructor(type, count, params) {
    this.params = params;
    this.baseType = type;
    this.count = count;

    this.base = getLattice(type, count, params);
    const degraded = getDegradedType(type);
    this.degraded = degraded ? getLattice(degraded, count, params) : null;

    this.scaleX = 1;
    this.scaleY = 1;
    this.mode = FormationMode.Open;
    this.demand = 1;
    this.smoothedDemand = 1;
  }

  get active() {
    return this.mode === FormationMode.File && this.degraded ? this.degraded : this.base;
  }

  /** World-space half-width the formation currently occupies. */
  get halfWidth() {
    const lattice = this.active;
    const scale = lattice === this.base ? this.scaleX : 1;
    return lattice.halfWidth * scale * this.params.spacing;
  }

  /**
   * Folds the group's clearance reading into the deformation state.
   *
   * @param {number} dt seconds
   * @param {number} availableHalfWidth free half-width for slot centres, i.e.
   *   corridor half-width already reduced by body radius and margin.
   */
  update(dt, availableHalfWidth) {
    const { params } = this;
    const nominalHalfWidth = this.base.halfWidth * params.spacing;

    // How much of the nominal shape fits. A shape with no width never squeezes.
    this.demand =
      nominalHalfWidth > 0 ? Math.max(0, availableHalfWidth) / nominalHalfWidth : Infinity;

    // Clearance readings jitter as the anchor moves between tiles; the group acts
    // on a smoothed belief about its room rather than on a single reading.
    if (!Number.isFinite(this.demand)) {
      this.smoothedDemand = this.demand;
    } else if (!Number.isFinite(this.smoothedDemand)) {
      this.smoothedDemand = this.demand;
    } else {
      const blend = Math.min(1, dt / params.clearanceSmoothing);
      this.smoothedDemand += (this.demand - this.smoothedDemand) * blend;
    }

    this.updateMode();

    const target =
      this.mode === FormationMode.File
        ? 1
        : Math.min(Math.max(this.smoothedDemand, this.base.lateralFloor), 1);

    // Contract quickly, expand slowly: narrowing early is cheap, widening early
    // puts an agent into a wall.
    const rate = target < this.scaleX ? params.contractRate : params.expandRate;
    const step = rate * dt;
    this.scaleX = Math.abs(target - this.scaleX) <= step
      ? target
      : this.scaleX + Math.sign(target - this.scaleX) * step;

    const lattice = this.active;
    this.scaleY =
      lattice === this.base ? longitudinalScale(this.scaleX, lattice.maxLongitudinal) : 1;

    if (this.mode !== FormationMode.File) {
      if (this.mode === FormationMode.Open) {
        this.mode = this.scaleX < OPEN_LEAVE ? FormationMode.Squeeze : FormationMode.Open;
      } else {
        this.mode = this.scaleX >= OPEN_ENTER ? FormationMode.Open : FormationMode.Squeeze;
      }
    }

    return this.mode;
  }

  /**
   * Enters file when narrowing can no longer buy enough room, and leaves it only
   * once there is hysteresis-width room to spare — otherwise a squad hovering at
   * a doorway flickers between shapes every tick.
   */
  updateMode() {
    if (!this.degraded) {
      return;
    }

    const floor = this.base.lateralFloor;

    if (this.mode === FormationMode.File) {
      if (this.smoothedDemand > floor + this.params.modeHysteresis) {
        this.mode = FormationMode.Squeeze;
      }

      return;
    }

    if (this.smoothedDemand < floor) {
      this.mode = FormationMode.File;
      this.scaleX = 1;
    }
  }

  /**
   * Slot positions in world space.
   *
   * Longitudinal offsets are measured back along the spine — the path the anchor
   * travelled — and lateral offsets across the spine's tangent there, so the
   * formation bends around corners instead of reaching through walls.
   */
  slots(spine, forward) {
    const lattice = this.active;
    const isBase = lattice === this.base;
    const scaleX = isBase ? this.scaleX : 1;
    const scaleY = isBase ? this.scaleY : 1;
    const { spacing } = this.params;

    return lattice.offsets.map((offset) => {
      const back = -offset.y * scaleY * spacing;
      const { point, tangent } = spine.sample(back, forward);
      return add(point, scale(rightOf(tangent), offset.x * scaleX * spacing));
    });
  }

  /** Diagnostic snapshot of the deformation state. */
  toJSON() {
    return {
      shape: this.active.type,
      mode: this.mode,
      scaleX: this.scaleX,
      scaleY: this.scaleY,
      demand: Number.isFinite(this.demand) ? this.demand : null,
      lateralFloor: this.base.lateralFloor,
    };
  }
}

export { FormationType };
