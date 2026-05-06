import readline from 'node:readline';
import { spawn } from 'node:child_process';
import process from 'node:process';
import {
  menuItem,
  clear,
  pressAnyKeyPrompt,
  pressEscPrompt,
  sectionTitle,
  startupBanner,
} from './renderer.js';
import type { CompleterFn } from './autocomplete.js';

export interface MenuOption {
  key: string;
  label: string;
  handler: () => Promise<void>;
}

export function matchMenuOption(
  key: string,
  options: MenuOption[],
): MenuOption | undefined {
  const lower = key.toLowerCase();
  return options.find((opt) => opt.key.toLowerCase() === lower);
}

export class InteractiveUI {
  start(): void {
    process.on('SIGINT', () => this.shutdown());
  }

  async showMenu(
    title: string,
    options: MenuOption[],
  ): Promise<void> {
    // offset=0.9 places the teal peak ~40% from the left
    // (center-left). Formula: peak position = offset - 0.5
    // for offset in [0.5, 1].
    const GRADIENT_OFFSET = 0.9;

    process.stdout.write(clear());
    process.stdout.write(startupBanner(GRADIENT_OFFSET));
    process.stdout.write(`\n${sectionTitle(title)}\n\n`);
    for (const opt of options) {
      process.stdout.write(menuItem(opt.key, opt.label) + '\n');
    }
    process.stdout.write('\n');

    const selected = await this.readRawKey(options);
    if (selected) await selected.handler();
  }

  async promptInput(
    prompt: string,
    completer?: CompleterFn,
  ): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        ...(completer ? { completer } : {}),
      });

      const onKeypress = (
        _ch: string,
        key: { name?: string; sequence?: string },
      ) => {
        if (key.name === 'escape') {
          process.stdin.off('keypress', onKeypress);
          rl.close();
          process.stdout.write('\n');
          resolve(null);
        }
      };
      process.stdin.on('keypress', onKeypress);

      rl.question(`${prompt} `, (answer) => {
        process.stdin.off('keypress', onKeypress);
        rl.close();
        resolve(answer.trim());
      });
    });
  }

  async promptConfirm(
    prompt: string,
  ): Promise<boolean | null> {
    const answer = await this.promptInput(
      `${prompt} [y/N]`,
    );
    if (answer === null) return null;
    return answer.toLowerCase() === 'y';
  }

  async runSubprocess(
    cmd: string,
    args: string[],
  ): Promise<'completed' | 'failed' | 'cancelled'> {
    return new Promise((resolve) => {
      const child = spawn(cmd, args, {
        stdio: ['ignore', 'inherit', 'inherit'],
      });

      let settled = false;
      const cleanup = () => {
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
        }
        process.stdin.pause();
        process.stdin.off('data', onKey);
      };

      const onKey = (key: string) => {
        if (key === '\u0003') {
          cleanup();
          child.kill('SIGTERM');
          this.shutdown();
          return;
        }
        if (key === '\x1B' && !settled) {
          settled = true;
          cleanup();
          child.kill('SIGTERM');
          resolve('cancelled');
        }
      };

      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', onKey);
      }

      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(code === 0 ? 'completed' : 'failed');
      });

      child.on('error', () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve('failed');
      });
    });
  }

  private readRawKey(
    options: MenuOption[],
  ): Promise<MenuOption | undefined> {
    return new Promise<MenuOption | undefined>((resolve) => {
      if (!process.stdin.isTTY) {
        resolve(undefined);
        return;
      }

      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf8');

      const onKey = (key: string) => {
        if (key === '\u0003') {
          this.shutdown();
          return;
        }
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.off('data', onKey);
        resolve(matchMenuOption(key, options));
      };

      process.stdin.on('data', onKey);
    });
  }

  async pressAnyKey(): Promise<void> {
    process.stdout.write(pressAnyKeyPrompt());
    return new Promise<void>((resolve) => {
      if (!process.stdin.isTTY) {
        resolve();
        return;
      }
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
      const onKey = (key: string) => {
        if (key === '\u0003') {
          this.shutdown();
          return;
        }
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.off('data', onKey);
        resolve();
      };
      process.stdin.on('data', onKey);
    });
  }

  async waitForEsc(): Promise<void> {
    process.stdout.write(pressEscPrompt());
    return new Promise<void>((resolve) => {
      if (!process.stdin.isTTY) {
        resolve();
        return;
      }
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
      const onKey = (key: string) => {
        if (key === '\u0003') {
          this.shutdown();
          return;
        }
        if (key === '\x1B') {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off('data', onKey);
          resolve();
        }
      };
      process.stdin.on('data', onKey);
    });
  }

  private shutdown(): void {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdout.write('\n');
    process.exit(0);
  }
}
