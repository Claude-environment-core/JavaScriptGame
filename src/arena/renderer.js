import { CANVAS_SIZE, INTERACTION_RADIUS } from "./config.js";

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
  }

  render(state) {
    const { ctx } = this;
    ctx.clearRect(0, 0, CANVAS_SIZE.width, CANVAS_SIZE.height);

    this.drawBackground(ctx, state);
    this.drawWorld(ctx, state);
    this.drawPrompts(ctx, state);
    this.drawOverlay(ctx, state);
  }

  drawBackground(ctx, state) {
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, CANVAS_SIZE.width, CANVAS_SIZE.height);

    ctx.fillStyle = "#111827";
    ctx.fillRect(state.bounds.x, state.bounds.y, state.bounds.width, state.bounds.height);

    ctx.strokeStyle = "#334155";
    ctx.lineWidth = 2;
    ctx.strokeRect(state.bounds.x, state.bounds.y, state.bounds.width, state.bounds.height);
  }

  drawWorld(ctx, state) {
    state.walls.forEach((wall) => {
      ctx.fillStyle = "#475569";
      ctx.fillRect(wall.x, wall.y, wall.width, wall.height);
    });

    state.cores.forEach((core) => {
      if (core.collected) {
        return;
      }

      ctx.fillStyle = "#fbbf24";
      ctx.beginPath();
      ctx.arc(core.x, core.y, core.radius, 0, Math.PI * 2);
      ctx.fill();
    });

    const switchConsole = state.switchConsole;
    ctx.fillStyle = switchConsole.activated ? "#22c55e" : "#fb7185";
    ctx.beginPath();
    ctx.arc(switchConsole.x, switchConsole.y, switchConsole.radius, 0, Math.PI * 2);
    ctx.fill();

    const exitDoor = state.exitDoor;
    ctx.fillStyle = exitDoor.isOpen ? "#22c55e" : exitDoor.isPowered ? "#38bdf8" : "#64748b";
    ctx.fillRect(exitDoor.x, exitDoor.y, exitDoor.width, exitDoor.height);

    const player = state.player;
    ctx.fillStyle = player.color;
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.radius, 0, Math.PI * 2);
    ctx.fill();
  }

  drawPrompts(ctx, state) {
    ctx.font = "16px Arial";
    ctx.textAlign = "center";

    if (state.switchConsole.canInteract(state.player) && !state.switchConsole.activated) {
      this.drawPrompt(ctx, state.switchConsole.x, state.switchConsole.y - 34, "Press E to restore exit controls");
    }

    if (state.exitDoor.canInteract(state.player) && state.exitDoor.isPowered && !state.exitDoor.isOpen) {
      this.drawPrompt(ctx, state.exitDoor.x + state.exitDoor.width / 2, state.exitDoor.y - 18, "Press E to open the exit");
    }

    if (state.exitDoor.isOpen) {
      this.drawPrompt(ctx, state.exitDoor.x + state.exitDoor.width / 2, state.exitDoor.y - 18, "Escape complete");
    }
  }

  drawPrompt(ctx, x, y, text) {
    ctx.fillStyle = "rgba(15, 23, 42, 0.92)";
    const textWidth = ctx.measureText(text).width;
    ctx.fillRect(x - textWidth / 2 - 8, y - 18, textWidth + 16, 28);
    ctx.fillStyle = "#f8fafc";
    ctx.fillText(text, x, y);
  }

  drawOverlay(ctx, state) {
    if (state.status !== "won") {
      return;
    }

    ctx.fillStyle = "rgba(15, 23, 42, 0.76)";
    ctx.fillRect(0, 0, CANVAS_SIZE.width, CANVAS_SIZE.height);
    ctx.fillStyle = "#f8fafc";
    ctx.textAlign = "center";
    ctx.font = "bold 36px Arial";
    ctx.fillText("Exit Reached", CANVAS_SIZE.width / 2, CANVAS_SIZE.height / 2 - 12);
    ctx.font = "18px Arial";
    ctx.fillText("Refresh the page to run the playground again.", CANVAS_SIZE.width / 2, CANVAS_SIZE.height / 2 + 26);
  }
}
