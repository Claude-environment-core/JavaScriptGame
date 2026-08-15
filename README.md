# JavaScriptGame

This repository now contains a small HTML5 Canvas prototype that recreates the requested gameplay concepts in a top-down 2D format with vanilla JavaScript.

## Run locally

- Open `/home/runner/work/JavaScriptGame/JavaScriptGame/index.html` directly in a browser, or
- Serve the repository root with a simple static server such as:

```bash
cd /home/runner/work/JavaScriptGame/JavaScriptGame
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Deploy to GitHub Pages

This repository includes a GitHub Actions workflow at `/home/runner/work/JavaScriptGame/JavaScriptGame/.github/workflows/deploy-pages.yml` that publishes the static site to GitHub Pages whenever changes land on `main`.

To enable it in GitHub:

1. Open the repository on GitHub.
2. Go to **Settings** → **Pages**.
3. Set **Source** to **GitHub Actions**.
4. Push or merge a change to `main`, or run the workflow manually from the **Actions** tab.

After the deployment completes, the game will be available at:

`https://claude-environment-core.github.io/JavaScriptGame/`

## Controls

- **Move:** `WASD` or Arrow Keys
- **Interact:** `E` or `Space`

## Gameplay mapping

The playable prototype focuses on the requested core concepts rather than 3D rendering fidelity:

- **Main game loop:** explicit `update` / `render` separation
- **Player controller:** free top-down movement with normalized diagonal speed
- **Collision and constraints:** walls, arena bounds, and a closed exit door block movement
- **Interaction/state flow:** collect all energy cores, activate the switch console, then open and reach the exit
- **Modular architecture:** input, entities, world setup, renderer, and game state are split into separate ES modules under `src/`

## Known gaps / differences

- The referenced Unity repository was not accessible from this environment during implementation, so the JavaScript prototype maps the confirmed requested concepts (movement, interaction, game loop/state, and collision) into a clean 2D playground rather than reproducing inaccessible Unity-specific content one-to-one.
- The presentation is intentionally top-down 2D Canvas instead of Unity's 3D view.