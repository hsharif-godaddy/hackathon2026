# Deep Build Reference

This corpus contains workflow planning knowledge for the Deep Build orchestrator.

## When to read

- **First turn (new workflow):** Read `summary.md` (this file) to orient
- **Planning turn:** Read the relevant archetype (`archetypes/site.md`, `archetypes/app.md`, `archetypes/game.md`, or `archetypes/custom.md`) plus `step-planning.md`

## Archetypes

| Archetype | Build unit | Parallelism | Use when |
|-----------|-----------|-------------|----------|
| `site` | Pages | High (2-4 concurrent) | Marketing sites, portfolios, blogs, landing pages |
| `app` | Features | Medium | Dashboards, CRUD apps, tools, interactive apps |
| `game` | Systems | Low | Browser games, interactive experiences |
| `custom` | Varies | Conservative | Doesn't fit above; agent builds DAG from scratch |

Choose based on the structural shape of the build, not the industry.

## Corpus files

| File | Read when |
|------|-----------|
| `archetypes/site.md` | Building a site (pages-based) |
| `archetypes/app.md` | Building an app (features-based) |
| `archetypes/game.md` | Building a game (systems-based) |
| `archetypes/custom.md` | Project doesn't fit other archetypes |
| `step-planning.md` | Constructing any step DAG |
