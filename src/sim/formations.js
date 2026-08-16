import { localToWorld } from "./vec2.js";

/**
 * Formation types. Every formation produces local offsets where `+y` points
 * along the squad's facing direction and `+x` points to its right.
 */
export const FormationType = Object.freeze({
  Wedge: "Wedge",
  Line: "Line",
  Column: "Column",
  Circle: "Circle",
  Spread: "Spread",
});

export const DEFAULT_FORMATION_SPACING = 1.2;

/**
 * Triangular rows trailing the leader.
 */
function wedgeOffsets(count, spacing) {
  const offsets = [];

  for (let i = 0; i < count; i += 1) {
    if (i === 0) {
      offsets.push({ x: 0, y: 0 });
      continue;
    }

    const row = Math.ceil(i / 2);
    const side = i % 2 === 1 ? -1 : 1;
    offsets.push({ x: side * row * spacing * 0.75, y: -row * spacing });
  }

  return offsets;
}

/** Lateral spread, centred on the anchor. */
function lineOffsets(count, spacing) {
  const offsets = [];
  const half = (count - 1) / 2;

  for (let i = 0; i < count; i += 1) {
    offsets.push({ x: (i - half) * spacing, y: 0 });
  }

  return offsets;
}

/** Single trailing file. */
function columnOffsets(count, spacing) {
  const offsets = [];

  for (let i = 0; i < count; i += 1) {
    offsets.push({ x: 0, y: -i * spacing });
  }

  return offsets;
}

/** Angularly even ring around the anchor. */
function circleOffsets(count, spacing) {
  const offsets = [];
  if (count === 0) {
    return offsets;
  }

  const radius = Math.max(spacing, (spacing * count) / (2 * Math.PI));

  for (let i = 0; i < count; i += 1) {
    const angle = (2 * Math.PI * i) / count;
    offsets.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  }

  return offsets;
}

/** Near-square distribution, centred on the anchor. */
function spreadOffsets(count, spacing) {
  const offsets = [];
  if (count === 0) {
    return offsets;
  }

  const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.ceil(count / columns);

  for (let i = 0; i < count; i += 1) {
    const column = i % columns;
    const row = Math.floor(i / columns);
    offsets.push({
      x: (column - (columns - 1) / 2) * spacing,
      y: -(row - (rows - 1) / 2) * spacing,
    });
  }

  return offsets;
}

/**
 * Local-space slot offsets for a formation.
 */
export function getFormationOffsets(type, count, spacing = DEFAULT_FORMATION_SPACING) {
  switch (type) {
    case FormationType.Line:
      return lineOffsets(count, spacing);
    case FormationType.Column:
      return columnOffsets(count, spacing);
    case FormationType.Circle:
      return circleOffsets(count, spacing);
    case FormationType.Spread:
      return spreadOffsets(count, spacing);
    case FormationType.Wedge:
    default:
      return wedgeOffsets(count, spacing);
  }
}

/**
 * Rotates local slot offsets into world space around an anchor.
 */
export function getFormationSlots(
  type,
  count,
  anchor,
  forward,
  spacing = DEFAULT_FORMATION_SPACING,
) {
  const offsets = getFormationOffsets(type, count, spacing);
  return offsets.map((offset) => localToWorld(anchor, forward, offset));
}
