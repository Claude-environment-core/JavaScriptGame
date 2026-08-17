import { CANVAS_SIZE } from "./config.js";
import { EnergyCore, ExitDoor, Player, Switch } from "./entities.js";

export function createWorld() {
  const bounds = {
    x: 24,
    y: 24,
    width: CANVAS_SIZE.width - 48,
    height: CANVAS_SIZE.height - 48,
  };

  const walls = [
    { x: 180, y: 110, width: 30, height: 300 },
    { x: 180, y: 380, width: 250, height: 30 },
    { x: 390, y: 110, width: 30, height: 180 },
    { x: 390, y: 110, width: 250, height: 30 },
    { x: 610, y: 110, width: 30, height: 240 },
    { x: 500, y: 320, width: 140, height: 30 },
    { x: 700, y: 250, width: 30, height: 220 },
  ];

  const player = new Player(90, 90);
  const cores = [
    new EnergyCore(115, 500),
    new EnergyCore(300, 170),
    new EnergyCore(545, 250),
  ];
  const switchConsole = new Switch(760, 510);
  const exitDoor = new ExitDoor(822, 64, 36, 80);

  return {
    bounds,
    walls,
    player,
    cores,
    switchConsole,
    exitDoor,
  };
}
