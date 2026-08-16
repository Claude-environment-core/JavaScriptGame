/**
 * Formation shapes.
 *
 * A shape is a nominal lattice in the squad's local frame, expressed in units of
 * `spacing` so that the deformation layer owns all scaling. Local `+y` points
 * along the squad's facing direction and `+x` to its right.
 *
 * A shape also declares what it is allowed to do under deformation: how far it
 * may stretch lengthwise, and which shape it degrades into when narrowing can no
 * longer buy enough room. It does not declare how far it may narrow — that floor
 * is derived from body size, in `deformation.js`, so no shape can declare itself
 * into a lattice tighter than the agents can physically occupy.
 */

export const FormationType = Object.freeze({
  Wedge: "Wedge",
  Line: "Line",
  Column: "Column",
  Circle: "Circle",
  Spread: "Spread",
});

/** Triangular rows trailing the leader. */
function wedgeOffsets(count) {
  const offsets = [];

  for (let i = 0; i < count; i += 1) {
    if (i === 0) {
      offsets.push({ x: 0, y: 0 });
      continue;
    }

    const row = Math.ceil(i / 2);
    const side = i % 2 === 1 ? -1 : 1;
    offsets.push({ x: side * row * 0.75, y: -row });
  }

  return offsets;
}

/** Lateral spread, centred on the anchor. */
function lineOffsets(count) {
  const half = (count - 1) / 2;
  return Array.from({ length: count }, (_, i) => ({ x: i - half, y: 0 }));
}

/** Single trailing file. */
function columnOffsets(count) {
  return Array.from({ length: count }, (_, i) => ({ x: 0, y: -i }));
}

/** Angularly even ring around the anchor. */
function circleOffsets(count) {
  if (count === 0) {
    return [];
  }

  const radius = Math.max(1, count / (2 * Math.PI));

  return Array.from({ length: count }, (_, i) => {
    const angle = (2 * Math.PI * i) / count;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });
}

/** Near-square block, centred on the anchor. */
function spreadOffsets(count) {
  if (count === 0) {
    return [];
  }

  const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.ceil(count / columns);

  return Array.from({ length: count }, (_, i) => ({
    x: (i % columns) - (columns - 1) / 2,
    y: -(Math.floor(i / columns) - (rows - 1) / 2),
  }));
}

const SHAPES = Object.freeze({
  [FormationType.Wedge]: {
    offsets: wedgeOffsets,
    maxLongitudinalScale: 2.0,
    degradesTo: FormationType.Column,
  },
  [FormationType.Line]: {
    offsets: lineOffsets,
    maxLongitudinalScale: 1.0,
    degradesTo: FormationType.Column,
  },
  [FormationType.Column]: {
    offsets: columnOffsets,
    maxLongitudinalScale: 1.0,
    degradesTo: null,
  },
  [FormationType.Circle]: {
    offsets: circleOffsets,
    maxLongitudinalScale: 1.0,
    degradesTo: FormationType.Column,
  },
  [FormationType.Spread]: {
    offsets: spreadOffsets,
    maxLongitudinalScale: 1.6,
    degradesTo: FormationType.Column,
  },
});

export function getShape(type) {
  return SHAPES[type] ?? SHAPES[FormationType.Wedge];
}

/** Nominal lattice for `count` agents, in units of spacing. */
export function getOffsets(type, count) {
  return getShape(type).offsets(count);
}

/** Shape it becomes when narrowing is exhausted, or `null` if it is already minimal. */
export function getDegradedType(type) {
  return getShape(type).degradesTo;
}

export function getMaxLongitudinalScale(type) {
  return getShape(type).maxLongitudinalScale;
}

/** Half-width and depth of a lattice, in units of spacing. */
export function getExtents(offsets) {
  let halfWidth = 0;
  let minY = 0;
  let maxY = 0;

  for (const offset of offsets) {
    halfWidth = Math.max(halfWidth, Math.abs(offset.x));
    minY = Math.min(minY, offset.y);
    maxY = Math.max(maxY, offset.y);
  }

  return { halfWidth, depth: maxY - minY };
}

/** Smallest distance between any two slots of a lattice, in units of spacing. */
export function getMinimumGap(offsets) {
  let smallest = Infinity;

  for (let i = 0; i < offsets.length; i += 1) {
    for (let j = i + 1; j < offsets.length; j += 1) {
      smallest = Math.min(smallest, Math.hypot(offsets[i].x - offsets[j].x, offsets[i].y - offsets[j].y));
    }
  }

  return smallest;
}
