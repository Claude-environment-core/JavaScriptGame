import { Game } from "./game.js";
import { InputHandler } from "./input.js";
import { Renderer } from "./renderer.js";
import { createWorld } from "./world.js";

const canvas = document.getElementById("gameCanvas");
const hud = {
  coreCount: document.getElementById("coreCount"),
  doorStatus: document.getElementById("doorStatus"),
  messageLine: document.getElementById("messageLine"),
};

const input = new InputHandler();
const renderer = new Renderer(canvas);
const world = createWorld();
const game = new Game(world, input, renderer, hud);

game.start();
