# Game Archetype

Use for browser games, interactive experiences, and game-like simulations. Build unit is the **system** — game systems are tightly interdependent and require low parallelism. Foundation (game loop, renderer, input) must be solid before building anything else.

<!-- inject-start -->
Build unit: systems (low parallelism, tightly coupled). Art direction gate before building.
Phases: interview → game design doc → plan → foundation (loop, renderer, input) → systems → content → polish.
Parallelism: low — systems are interdependent. Foundation must be solid first.
Verify: tsc heavily, manual for playtesting gates, files_exist for assets.
Skills load after planning, before build.
<!-- inject-end -->

## Typical DAG

```
interview → game-design-doc → design-approval (gate) → planning → plan-review
→ foundation (game loop, renderer, input system)
→ [core-mechanics, ui-system] (limited parallelism)
→ content (levels, assets) → integration → playtesting (gate) → polish
```

## Example step plan

```json
{
  "archetype": "game",
  "northStar": { "goals": ["..."], "audience": "...", "voice": "..." },
  "steps": [
    { "id": "interview", "type": "auto", "title": "Collect game concept via interview", "dependsOn": [], "ownedFiles": ["docs/brief.md"], "verify": [{"kind": "files_exist", "spec": "docs/brief.md"}] },
    { "id": "game-design-doc", "type": "auto", "title": "Create game design document", "dependsOn": ["interview"], "ownedFiles": ["docs/game-design.md", "docs/design.md", "src/styles/globals.css"], "verify": [{"kind": "files_exist", "spec": "docs/game-design.md"}] },
    { "id": "design-approval", "type": "gate", "title": "User approves game concept and art direction", "dependsOn": ["game-design-doc"], "ownedFiles": [], "verify": [], "gate": {"prompt": "Here's the game design and art direction. Does this match what you have in mind? Any mechanics or visual style to change?"} },
    { "id": "planning", "type": "auto", "title": "Create implementation plan", "dependsOn": ["design-approval"], "ownedFiles": ["docs/plans/game.md"], "verify": [{"kind": "files_exist", "spec": "docs/plans/game.md"}] },
    { "id": "plan-review", "type": "auto", "title": "Review and refine plan", "dependsOn": ["planning"], "ownedFiles": [], "verify": [] },
    { "id": "skill-install", "type": "auto", "title": "Install required skills (media-image)", "dependsOn": ["plan-review"], "ownedFiles": [], "verify": [] },
    { "id": "foundation", "type": "auto", "title": "Build game foundation (loop, renderer, input)", "dependsOn": ["skill-install"], "ownedFiles": ["src/game/GameEngine.ts", "src/game/Renderer.ts", "src/game/InputManager.ts", "src/game/GameState.ts", "src/App.tsx"], "verify": [{"kind": "tsc", "spec": ""}, {"kind": "files_exist", "spec": "src/game/GameEngine.ts"}] },
    { "id": "core-mechanics", "type": "auto", "title": "Build core game mechanics", "dependsOn": ["foundation"], "ownedFiles": ["src/game/mechanics/", "src/game/entities/", "src/game/physics/"], "verify": [{"kind": "tsc", "spec": ""}, {"kind": "files_exist", "spec": "src/game/mechanics/"}] },
    { "id": "ui-system", "type": "auto", "title": "Build game UI (HUD, menus, score)", "dependsOn": ["foundation"], "ownedFiles": ["src/components/HUD.tsx", "src/components/MainMenu.tsx", "src/components/GameOver.tsx"], "verify": [{"kind": "tsc", "spec": ""}, {"kind": "files_exist", "spec": "src/components/HUD.tsx"}] },
    { "id": "content", "type": "auto", "title": "Build game content (levels, enemies, items)", "dependsOn": ["core-mechanics", "ui-system"], "ownedFiles": ["src/game/levels/", "src/game/enemies/", "src/assets/"], "verify": [{"kind": "files_exist", "spec": "src/game/levels/"}, {"kind": "tsc", "spec": ""}] },
    { "id": "integration", "type": "auto", "title": "Wire systems together and wire UI to game state", "dependsOn": ["content"], "ownedFiles": ["src/game/GameScene.ts"], "verify": [{"kind": "tsc", "spec": ""}] },
    { "id": "playtesting", "type": "gate", "title": "User playtests the game", "dependsOn": ["integration"], "ownedFiles": [], "verify": [], "gate": {"prompt": "The game is playable. Give it a try — does the gameplay feel right? Any mechanics, difficulty, or controls to adjust?"} },
    { "id": "polish", "type": "auto", "title": "Juice, sound hooks, performance", "dependsOn": ["playtesting"], "ownedFiles": ["src/game/effects/", "src/game/audio/"], "verify": [{"kind": "tsc", "spec": ""}] },
    { "id": "final-verify", "type": "auto", "title": "Final verification", "dependsOn": ["polish"], "ownedFiles": [], "verify": [{"kind": "tsc", "spec": ""}] }
  ]
}
```

## DAG structure notes

- No design preview showcase (no marketing brand to show) — gate is on the game design doc instead
- Foundation is the critical path — everything depends on the game loop and renderer being correct
- `core-mechanics` and `ui-system` can run in limited parallelism (they own separate files)
- Content depends on both mechanics and UI being stable — don't build levels on a moving target
- Integration always sequential — wires GameEngine to UI components
- Playtesting gate mid-build is important — game feel often requires iteration

## Build phases

| Phase | Steps | Notes |
|-------|-------|-------|
| 0 | interview | Interactive |
| 1 | game-design-doc | Background — creates design + GDD |
| 2 | design-approval | Gate pauses |
| 3 | planning, plan-review, skill-install | Sequential |
| 4 | foundation | Single builder — critical path |
| 5 | core-mechanics + ui-system (limited parallel) | 2 builders max |
| 6 | content | Single builder or 2 parallel if content is independent |
| 7 | integration | Single builder |
| 8 | playtesting | Gate |
| 9 | polish, final-verify | Single builder |

## Parallelism rules

- Foundation is always sequential and must be solid before anything else
- Only 2 systems max in parallel, and only if their `ownedFiles` are completely disjoint
- Content (levels, assets) can parallelize more freely once systems are stable
- Never run mechanics and UI concurrently if they share game state types
- Default to sequential when uncertain — game systems fail in subtle ways with shared state

## Common skills

- `media-image` — sprite generation, background art, UI icons
- `database` — leaderboards, save states

For asset generation: dispatch `media-image` after planning so the Asset Inventory defines exactly what's needed.

## Verify emphasis

- `tsc` — after every builder, especially foundation (type errors in game state cascade everywhere)
- `manual` — playtesting gate is essential; automated tests can't catch game feel issues
- `files_exist` — for asset directories and level files
- `test` — for pure functions (collision detection, score calculation) if the plan includes them
