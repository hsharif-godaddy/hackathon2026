import { menuItem, divider } from '../renderer.js';

export function helpText(): string {
  const lines = [
    '',
    divider(40),
    '',
    'COMMANDS',
    menuItem('1', 'Run Evals          — run evaluation scenarios'),
    menuItem('2', 'List Scenarios     — browse available scenarios'),
    menuItem('3', 'Config             — view and edit .env settings'),
    menuItem('4', 'Results            — browse past eval runs'),
    menuItem('5', 'Baselines          — manage scenario baselines'),
    menuItem('h', 'Help               — show this help'),
    menuItem('q', 'Quit               — exit gosym-probe'),
    '',
    'KEYBOARD SHORTCUTS',
    '  Press a key to select — no Enter needed',
    '  Ctrl+C exits at any time',
    '',
    divider(40),
    '',
  ];
  return lines.join('\n');
}
