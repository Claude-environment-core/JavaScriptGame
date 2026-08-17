import { circleIntersectsRect } from "./utils.js";
import { FRAME_TIME_CAP } from "./config.js";

export class Game {
  constructor(world, input, renderer, hud) {
    this.world = world;
    this.input = input;
    this.renderer = renderer;
    this.hud = hud;
    this.lastTimestamp = 0;

    this.state = {
      ...world,
      collectedCores: 0,
      totalCores: world.cores.length,
      message: "Restore power by collecting every core.",
      status: "running",
    };
  }

  start() {
    window.requestAnimationFrame((timestamp) => this.loop(timestamp));
  }

  loop(timestamp) {
    const deltaTime = Math.min((timestamp - this.lastTimestamp) / 1000 || 0, FRAME_TIME_CAP);
    this.lastTimestamp = timestamp;

    this.update(deltaTime);
    this.renderer.render(this.state);
    this.syncHud();
    this.input.endFrame();

    if (this.state.status !== "won") {
      window.requestAnimationFrame((nextTimestamp) => this.loop(nextTimestamp));
    }
  }

  update(deltaTime) {
    const { player, bounds, walls, cores, switchConsole, exitDoor } = this.state;

    player.move(this.input, deltaTime, bounds, this.getBlockers());

    cores.forEach((core) => {
      if (core.collect(player)) {
        this.state.collectedCores += 1;
        this.state.message = `${this.state.collectedCores} / ${this.state.totalCores} energy cores restored.`;
      }
    });

    exitDoor.isPowered = this.state.collectedCores === this.state.totalCores && switchConsole.activated;

    if (this.input.consumePress("e", "E", " ")) {
      if (switchConsole.tryInteract(player)) {
        this.state.message = "Exit controls online. Restore the remaining cores.";
      } else if (exitDoor.tryInteract(player)) {
        this.state.message = "Exit door unlocked.";
      }
    }

    if (exitDoor.isOpen && circleIntersectsRect(player, exitDoor)) {
      this.state.status = "won";
      this.state.message = "Prototype complete. The arena loop has been cleared.";
    } else if (!switchConsole.activated) {
      this.state.message = "Collect every core and activate the switch console.";
    } else if (!exitDoor.isPowered) {
      this.state.message = "Power the exit by collecting every remaining core.";
    } else if (!exitDoor.isOpen) {
      this.state.message = "Approach the exit and interact to escape.";
    }
  }

  getBlockers() {
    const blockers = [...this.state.walls];

    if (!this.state.exitDoor.isOpen) {
      blockers.push(this.state.exitDoor);
    }

    return blockers;
  }

  syncHud() {
    this.hud.coreCount.textContent = `Cores: ${this.state.collectedCores} / ${this.state.totalCores}`;
    this.hud.doorStatus.textContent = `Exit: ${
      this.state.exitDoor.isOpen
        ? "Open"
        : this.state.exitDoor.isPowered
          ? "Powered"
          : "Offline"
    }`;
    this.hud.messageLine.textContent = this.state.message;
  }
}
