import { InteractiveUI } from './ui.js';
import { createCliDeps } from './client-factory.js';
import { buildMainMenu } from './menu-builders.js';

async function main(): Promise<void> {
  const { scenarios, evalStore, baselineStore } = createCliDeps();

  const ui = new InteractiveUI();
  ui.start();

  const options = buildMainMenu(
    ui,
    scenarios,
    evalStore,
    baselineStore,
  );

  while (true) {
    await ui.showMenu('Select an option:', options);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
