#!/usr/bin/env node

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import figlet from 'figlet';
import gradient from 'gradient-string';
import os from 'os';
import which from 'which';
import dotenv from 'dotenv';
import enquirer from 'enquirer';
const { AutoComplete } = enquirer;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load config
const config = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'dbconfig.json'), 'utf-8')
);

const { defaults, prompts, availableTools, environments } = config;

function printBanner(dbName, alias) {
  const bannerText = `${dbName.toUpperCase()} @ ${alias.toUpperCase()}`;
  const ascii = figlet.textSync(bannerText, {
    font: 'Standard',
    horizontalLayout: 'default',
    verticalLayout: 'default',
  });
  console.log(gradient.rainbow.multiline(ascii));
}

function commandExists(cmd) {
  try {
    which.sync(cmd);
    return true;
  } catch {
    return false;
  }
}

function detectPipCommand() {
  if (commandExists('pip')) return 'pip install pgcli';
  if (commandExists('pip3')) return 'pip3 install pgcli';
  return null;
}

function getInstallInstructions(cmd) {
  const platform = os.platform();
  const osInfo = {
    darwin: 'macOS',
    win32: 'Windows',
    linux: 'Linux',
  }[platform] || platform;

  if (cmd === 'pgcli') {
    const pipCmd = detectPipCommand();
    if (pipCmd) return pipCmd;
    return {
      macOS: 'brew install pgcli or pip3 install pgcli',
      Linux: 'pip3 install pgcli (or install pip first)',
      Windows: 'pip3 install pgcli (install Python from python.org if needed)',
    }[osInfo];
  }

  if (cmd === 'psql') {
    return {
      macOS: 'brew install postgresql',
      Linux: 'sudo apt install postgresql-client',
      Windows: 'Download from https://www.postgresql.org/download/windows/',
    }[osInfo];
  }

  return 'Please install this tool manually.';
}

async function main() {
  try {
    const envFiles = fs.readdirSync(path.join(__dirname, '..'))
      .filter(f => f.startsWith('.env.') && !f.endsWith('.example'));

    let selectedEnv = defaults.environment;
    const envChoices = envFiles.map(f => f.replace('.env.', ''));

    if (envChoices.length === 0) {
      console.error(chalk.red('❌ No .env.[environment] files found.'));
      process.exit(1);
    }

    if (envChoices.length > 1 && prompts.environment !== false) {
      const envPrompt = new AutoComplete({
        name: 'environment',
        message: 'Select environment',
        choices: envChoices,
        initial: envChoices.indexOf(defaults.environment),
      });
      selectedEnv = await envPrompt.run();
    }

    dotenv.config({ path: path.join(__dirname, '..', `.env.${selectedEnv}`) });

    const environmentConfig = environments[selectedEnv];
    if (!environmentConfig) {
      console.error(chalk.red(`❌ No config found for environment "${selectedEnv}"`));
      process.exit(1);
    }

    const availableToolChoices = availableTools.filter(tool => {
      const found = commandExists(tool);
      if (!found) {
        const tip = getInstallInstructions(tool);
        console.log(chalk.yellow(`⚠️  "${tool}" not found. Install with:`));
        console.log(chalk.cyan(`   ${tip}\n`));
      }
      return found;
    });

    if (availableToolChoices.length === 0) {
      console.error(chalk.red('❌ No supported DB tools found.'));
      process.exit(1);
    }

    let selectedTool = defaults.tool;
    if (prompts.tool !== false) {
      const toolPrompt = new AutoComplete({
        name: 'tool',
        message: 'Select DB Tool',
        choices: availableToolChoices,
        initial: availableToolChoices.indexOf(defaults.tool),
      });
      selectedTool = await toolPrompt.run();
    }

    let selectedAlias = defaults.portAlias;
    if (prompts.port !== false) {
      const portPrompt = new AutoComplete({
        name: 'portAlias',
        message: 'Select port alias',
        choices: Object.keys(environmentConfig.portAliases),
        initial: Object.keys(environmentConfig.portAliases).indexOf(defaults.portAlias),
      });
      selectedAlias = await portPrompt.run();
    }

    const selectedPort = environmentConfig.portAliases[selectedAlias];

    let selectedDatabase = defaults.database;
    if (prompts.database !== false) {
      const dbPrompt = new AutoComplete({
        name: 'database',
        message: 'Select database',
        choices: environmentConfig.databases,
        initial: environmentConfig.databases.indexOf(defaults.database),
      });
      selectedDatabase = await dbPrompt.run();
    }

    console.clear();
    printBanner(selectedDatabase, selectedAlias);

    const {
      DB_READ_PROXY_HOST,
      DB_READ_PROXY_USER,
      DB_READ_PROXY_PASSWORD,
    } = process.env;

    if (!DB_READ_PROXY_HOST || !DB_READ_PROXY_USER || !DB_READ_PROXY_PASSWORD) {
      console.error(chalk.red('❌ Missing required environment variables.'));
      process.exit(1);
    }

    console.log(
      chalk.cyan(`🔌 Connecting using ${chalk.bold(selectedTool)} to ${chalk.bold(selectedDatabase)} @ ${chalk.bold(DB_READ_PROXY_HOST)}:${chalk.bold(selectedPort)}\n`)
    );

    const cliArgs = selectedTool === 'pgcli'
      ? ['-h', DB_READ_PROXY_HOST, '-p', selectedPort, '-U', DB_READ_PROXY_USER, '-d', selectedDatabase]
      : ['-h', DB_READ_PROXY_HOST, '-p', selectedPort, '-U', DB_READ_PROXY_USER, selectedDatabase];

    const dbProcess = spawn(selectedTool, cliArgs, {
      env: {
        ...process.env,
        PGPASSWORD: DB_READ_PROXY_PASSWORD,
      },
      stdio: 'inherit',
    });

    dbProcess.on('exit', (code) => {
      if (code === 0) {
        console.log(chalk.green(`✅ ${selectedTool} session ended successfully.`));
      } else {
        console.error(chalk.red(`❌ ${selectedTool} exited with code ${code}`));
      }
      process.exit(code);
    });

  } catch (err) {
    console.error(chalk.red(`❌ ${err.message || err}`));
    process.exit(1);
  }
}

main();
