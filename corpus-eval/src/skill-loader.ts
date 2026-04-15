#!/usr/bin/env node

import { Command } from 'commander';

import { runSkillLoader } from './skill-loader/runner.js';

const program = new Command();

program
  .name('skill-loader')
  .description('Evaluate whether the develop agent loads the correct skills for given prompts')
  .version('1.0.0');

program
  .command('run')
  .description('Run skill loader evaluation')
  .argument('<corpus>', 'Path to a YAML corpus file or directory of YAML files')
  .option('-v, --verbose', 'Show per-case results')
  .action(async (corpusPath: string, options: { verbose?: boolean }) => {
    console.log(`\nSkill Loader Evaluation`);
    console.log(`Corpus: ${corpusPath}`);

    const result = await runSkillLoader(corpusPath, { verbose: options.verbose });

    if (!result.passed) {
      console.log(`\n❌ ${result.failedCases} case(s) failed`);
      process.exit(1);
    } else {
      console.log(`\n✅ All ${result.passedCases} case(s) passed`);
    }
  });

program.parseAsync().catch(err => {
  console.error('Error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
