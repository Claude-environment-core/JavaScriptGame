import { clone, normalize, scale, vec2 } from "./vec2.js";

export const DEFAULT_PLAYER_SPEED = 3;
export const DEFAULT_PLAYER_RADIUS = 0.24;

const DEFAULT_INPUT_BINDINGS = Object.freeze({
  up: ["w", "W", "ArrowUp"],
  down: ["s", "S", "ArrowDown"],
  left: ["a", "A", "ArrowLeft"],
  right: ["d", "D", "ArrowRight"],
});

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export class KeyboardPlayerController {
  constructor({
    target = typeof window === "undefined" ? null : window,
    bindings = DEFAULT_INPUT_BINDINGS,
  } = {}) {
    this.target = target;
    this.bindings = bindings;
    this.keysDown = new Set();
    this.boundKeys = new Set(Object.values(bindings).flat());

    this.handleKeyDown = (event) => {
      if (!this.boundKeys.has(event.key)) {
        return;
      }

      this.keysDown.add(event.key);
      event.preventDefault();
    };

    this.handleKeyUp = (event) => {
      if (!this.boundKeys.has(event.key)) {
        return;
      }

      this.keysDown.delete(event.key);
      event.preventDefault();
    };

    this.target?.addEventListener?.("keydown", this.handleKeyDown);
    this.target?.addEventListener?.("keyup", this.handleKeyUp);
  }

  isPressed(group) {
    return this.bindings[group].some((key) => this.keysDown.has(key));
  }

  direction() {
    return vec2(
      (this.isPressed("right") ? 1 : 0) - (this.isPressed("left") ? 1 : 0),
      (this.isPressed("down") ? 1 : 0) - (this.isPressed("up") ? 1 : 0),
    );
  }

  dispose() {
    this.target?.removeEventListener?.("keydown", this.handleKeyDown);
    this.target?.removeEventListener?.("keyup", this.handleKeyUp);
    this.keysDown.clear();
  }
}

export class Player {
  constructor({
    id = "player",
    position = vec2(),
    velocity = vec2(),
    speed = DEFAULT_PLAYER_SPEED,
    radius = DEFAULT_PLAYER_RADIUS,
    color = "#22d3ee",
  } = {}) {
    this.id = id;
    this.position = clone(position);
    this.velocity = clone(velocity);
    this.speed = speed;
    this.radius = radius;
    this.color = color;
  }

  tick(dt, map, controller = null) {
    const input = controller?.direction?.() ?? vec2();
    const direction = normalize(input);

    if (direction.x === 0 && direction.y === 0) {
      this.velocity = vec2();
      return;
    }

    this.velocity = scale(direction, this.speed);
    this.stepAxis(this.velocity.x * dt, "x", map);
    this.stepAxis(this.velocity.y * dt, "y", map);
  }

  stepAxis(delta, axis, map) {
    if (delta === 0) {
      return;
    }

    const stepSize = Math.max(this.radius * 0.5, 0.05);
    const steps = Math.max(1, Math.ceil(Math.abs(delta) / stepSize));
    const increment = delta / steps;

    for (let i = 0; i < steps; i += 1) {
      this.position[axis] += increment;

      if (!map) {
        continue;
      }

      this.resolveMapCollisions(map, axis, Math.sign(increment));
      this.position.x = clamp(this.position.x, this.radius, map.width - this.radius);
      this.position.y = clamp(this.position.y, this.radius, map.height - this.radius);
    }
  }

  resolveMapCollisions(map, axis, directionSign) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let collided = false;

      const minX = Math.floor(this.position.x - this.radius);
      const maxX = Math.floor(this.position.x + this.radius);
      const minY = Math.floor(this.position.y - this.radius);
      const maxY = Math.floor(this.position.y + this.radius);

      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          if (map.isWalkable(x, y)) {
            continue;
          }

          const nearestX = clamp(this.position.x, x, x + 1);
          const nearestY = clamp(this.position.y, y, y + 1);
          const dx = this.position.x - nearestX;
          const dy = this.position.y - nearestY;
          const distanceSquared = dx * dx + dy * dy;

          if (distanceSquared >= this.radius * this.radius) {
            continue;
          }

          collided = true;

          if (axis === "x") {
            if (Math.abs(dx) > 1e-6) {
              this.position.x += Math.sign(dx) * (this.radius - Math.abs(dx));
            } else {
              this.position.x = directionSign >= 0 ? x - this.radius : x + 1 + this.radius;
            }
          } else if (Math.abs(dy) > 1e-6) {
            this.position.y += Math.sign(dy) * (this.radius - Math.abs(dy));
          } else {
            this.position.y = directionSign >= 0 ? y - this.radius : y + 1 + this.radius;
          }
        }
      }

      if (!collided) {
        return;
      }
    }
  }
}
