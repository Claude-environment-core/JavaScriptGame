import { INTERACTION_RADIUS, PLAYER_RADIUS, PLAYER_SPEED } from "./config.js";
import { clamp, distanceBetween, normalize } from "./utils.js";

export class Player {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.radius = PLAYER_RADIUS;
    this.speed = PLAYER_SPEED;
    this.color = "#38bdf8";
  }

  move(input, deltaTime, bounds, blockers) {
    const horizontal =
      (input.isDown("d", "D", "ArrowRight") ? 1 : 0) -
      (input.isDown("a", "A", "ArrowLeft") ? 1 : 0);
    const vertical =
      (input.isDown("s", "S", "ArrowDown") ? 1 : 0) -
      (input.isDown("w", "W", "ArrowUp") ? 1 : 0);
    const direction = normalize(horizontal, vertical);

    if (direction.x === 0 && direction.y === 0) {
      return;
    }

    this.x += direction.x * this.speed * deltaTime;
    this.resolveCollisions(blockers, "x", bounds);

    this.y += direction.y * this.speed * deltaTime;
    this.resolveCollisions(blockers, "y", bounds);
  }

  resolveCollisions(blockers, axis, bounds) {
    this.x = clamp(this.x, bounds.x + this.radius, bounds.x + bounds.width - this.radius);
    this.y = clamp(this.y, bounds.y + this.radius, bounds.y + bounds.height - this.radius);

    blockers.forEach((blocker) => {
      const nearestX = clamp(this.x, blocker.x, blocker.x + blocker.width);
      const nearestY = clamp(this.y, blocker.y, blocker.y + blocker.height);
      const dx = this.x - nearestX;
      const dy = this.y - nearestY;
      const squaredDistance = dx * dx + dy * dy;

      if (squaredDistance >= this.radius * this.radius) {
        return;
      }

      if (axis === "x") {
        if (this.x < blocker.x + blocker.width / 2) {
          this.x = blocker.x - this.radius;
        } else {
          this.x = blocker.x + blocker.width + this.radius;
        }
      } else {
        if (this.y < blocker.y + blocker.height / 2) {
          this.y = blocker.y - this.radius;
        } else {
          this.y = blocker.y + blocker.height + this.radius;
        }
      }
    });
  }
}

export class EnergyCore {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.radius = 12;
    this.collected = false;
  }

  collect(player) {
    if (this.collected || distanceBetween(this, player) > this.radius + player.radius + 2) {
      return false;
    }

    this.collected = true;
    return true;
  }
}

export class Switch {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.radius = 18;
    this.activated = false;
  }

  canInteract(player) {
    return distanceBetween(this, player) <= INTERACTION_RADIUS;
  }

  tryInteract(player) {
    if (!this.canInteract(player) || this.activated) {
      return false;
    }

    this.activated = true;
    return true;
  }
}

export class ExitDoor {
  constructor(x, y, width, height) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
    this.isPowered = false;
    this.isOpen = false;
  }

  canInteract(player) {
    const doorCenter = {
      x: this.x + this.width / 2,
      y: this.y + this.height / 2,
    };

    return distanceBetween(doorCenter, player) <= INTERACTION_RADIUS;
  }

  tryInteract(player) {
    if (!this.isPowered || !this.canInteract(player)) {
      return false;
    }

    this.isOpen = true;
    return true;
  }
}
