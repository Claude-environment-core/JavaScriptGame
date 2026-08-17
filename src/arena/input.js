const ACTIVE_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "w",
  "a",
  "s",
  "d",
  "W",
  "A",
  "S",
  "D",
  "e",
  "E",
  " ",
]);

export class InputHandler {
  constructor() {
    this.pressedKeys = new Set();
    this.justPressed = new Set();

    window.addEventListener("keydown", (event) => {
      if (!ACTIVE_KEYS.has(event.key)) {
        return;
      }

      if (!this.pressedKeys.has(event.key)) {
        this.justPressed.add(event.key);
      }

      this.pressedKeys.add(event.key);
      event.preventDefault();
    });

    window.addEventListener("keyup", (event) => {
      if (!ACTIVE_KEYS.has(event.key)) {
        return;
      }

      this.pressedKeys.delete(event.key);
      event.preventDefault();
    });
  }

  isDown(...keys) {
    return keys.some((key) => this.pressedKeys.has(key));
  }

  consumePress(...keys) {
    const match = keys.some((key) => this.justPressed.has(key));
    keys.forEach((key) => this.justPressed.delete(key));
    return match;
  }

  endFrame() {
    this.justPressed.clear();
  }
}
