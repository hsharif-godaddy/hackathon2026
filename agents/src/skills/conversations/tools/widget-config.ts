import { readFile, writeFile } from 'fs/promises';

export interface WidgetConfig {
  _support: {
    account: string;
    ui: {
      widget: {
        icon: string;
        color: string;
        position: string;
      };
    };
  };
}

const DEFAULT_CONFIG: WidgetConfig = {
  _support: {
    account: '',
    ui: {
      widget: {
        icon: 'webChat',
        color: '',
        position: 'bottom-right',
      },
    },
  },
};

export async function readWidgetConfig(configPath: string): Promise<WidgetConfig> {
  let content: string;
  try {
    content = await readFile(configPath, 'utf-8');
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return structuredClone(DEFAULT_CONFIG);
    }
    throw err;
  }
  return JSON.parse(content) as WidgetConfig;
}

export async function writeWidgetConfig(configPath: string, config: WidgetConfig): Promise<void> {
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
}
