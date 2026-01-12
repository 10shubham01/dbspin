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
import { visualizeQuery } from './visualize.js';
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
    // Parse command line arguments
    const args = process.argv.slice(2);

    // Check for help flag
    if (args.includes('--help') || args.includes('-h')) {
      console.log(`
${chalk.bold('DB Connect CLI')}

${chalk.cyan('Interactive Mode:')}
  dbspin

${chalk.cyan('Direct Mode:')}
  dbspin <port_alias> <database_name>

${chalk.cyan('Visualization Mode:')}
  dbspin --visualize <port_alias> <database> "<SQL_QUERY>"
  dbspin -v <port_alias> <database> "<SQL_QUERY>"
  
  Optional flags:
  dbspin -v <port_alias> <database> "<SQL_QUERY>" --chart <bar|line|pie|doughnut|radar>
  dbspin -v <port_alias> <database> "<SQL_QUERY>" --analyze <column_name>

${chalk.cyan('Options:')}
  -h, --help           Show this help message
  -v, --visualize      Execute query and visualize results with Chart.js
  --chart <type>       Specify chart type (bar, line, pie, doughnut, radar)
  --analyze <column>   Specify which column to analyze (default: first numeric column)

${chalk.cyan('Examples:')}
  dbspin d7 db_novio_score
  dbspin dev db_credilio
  dbspin -v d7 db_novio_score "SELECT status, COUNT(*) as count FROM users GROUP BY status"
  dbspin --visualize d7 db_novio_score "SELECT date, revenue FROM sales LIMIT 10" --chart line
  dbspin -v d7 db_novio_score "SELECT rendering_cost, rendering_time FROM logs" --analyze rendering_time
      `);
      process.exit(0);
    }

    // Check for visualization mode
    const visualizeMode = args.includes('--visualize') || args.includes('-v');
    let providedAlias, providedDatabase, queryString, chartType, analyzeColumn;

    if (visualizeMode) {
      // Remove the flag
      const flagIndex = args.findIndex(arg => arg === '--visualize' || arg === '-v');
      args.splice(flagIndex, 1);

      // Check for chart type
      const chartIndex = args.indexOf('--chart');
      if (chartIndex !== -1 && args[chartIndex + 1]) {
        chartType = args[chartIndex + 1];
        args.splice(chartIndex, 2); // Remove --chart and its value
      }

      // Check for analyze column
      const analyzeIndex = args.indexOf('--analyze');
      if (analyzeIndex !== -1 && args[analyzeIndex + 1]) {
        analyzeColumn = args[analyzeIndex + 1];
        args.splice(analyzeIndex, 2); // Remove --analyze and its value
      }

      providedAlias = args[0];
      providedDatabase = args[1];
      queryString = args[2];

      if (!providedAlias || !providedDatabase || !queryString) {
        console.error(chalk.red('❌ Visualization mode requires: <port_alias> <database> "<query>"'));
        process.exit(1);
      }
    } else {
      providedAlias = args[0];
      providedDatabase = args[1];

      // Validate that we don't have extra arguments
      if (args.length > 2) {
        console.error(chalk.red('❌ Too many arguments. Use --help for usage information.'));
        process.exit(1);
      }
    }

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

    let selectedAlias = providedAlias || defaults.portAlias;
    if (!providedAlias && prompts.port !== false) {
      const portPrompt = new AutoComplete({
        name: 'portAlias',
        message: 'Select port alias',
        choices: Object.keys(environmentConfig.portAliases),
        initial: Object.keys(environmentConfig.portAliases).indexOf(defaults.portAlias),
      });
      selectedAlias = await portPrompt.run();
    }

    // Validate provided alias
    if (providedAlias && !environmentConfig.portAliases[providedAlias]) {
      console.error(chalk.red(`❌ Invalid port alias "${providedAlias}". Available aliases: ${Object.keys(environmentConfig.portAliases).join(', ')}`));
      process.exit(1);
    }

    const selectedPort = environmentConfig.portAliases[selectedAlias];

    let selectedDatabase = providedDatabase || defaults.database;
    if (!providedDatabase && prompts.database !== false) {
      const dbPrompt = new AutoComplete({
        name: 'database',
        message: 'Select database',
        choices: environmentConfig.databases,
        initial: environmentConfig.databases.indexOf(defaults.database),
      });
      selectedDatabase = await dbPrompt.run();
    }

    // Validate provided database
    if (providedDatabase && !environmentConfig.databases.includes(providedDatabase)) {
      console.error(chalk.red(`❌ Invalid database "${providedDatabase}". Available databases: ${environmentConfig.databases.join(', ')}`));
      process.exit(1);
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

    // Handle visualization mode
    if (visualizeMode) {
      const connectionConfig = {
        host: DB_READ_PROXY_HOST,
        port: selectedPort,
        user: DB_READ_PROXY_USER,
        password: DB_READ_PROXY_PASSWORD,
        database: selectedDatabase,
      };

      await visualizeQuery(connectionConfig, queryString, chartType, analyzeColumn);
      process.exit(0);
    }

    // Set up timezone and formatting for the database client
    let pgcliConfigPath;
    if (selectedTool === 'psql') {
      const psqlrcPath = path.join(process.cwd(), '.psqlrc');
      const psqlrcContent = `SET timezone = 'Asia/Kolkata';\nSET datestyle = 'Postgres, DMY';\n`;
      fs.writeFileSync(psqlrcPath, psqlrcContent);
    } else if (selectedTool === 'pgcli') {
      pgcliConfigPath = path.join(os.tmpdir(), `pgcli_config_${Date.now()}`);
      const configContent = `[main]\non_startup = SET timezone = 'Asia/Kolkata'; SET datestyle = 'Postgres, DMY';\n`;
      fs.writeFileSync(pgcliConfigPath, configContent);
    }

    console.log(
      chalk.cyan(`🔌 Connecting using ${chalk.bold(selectedTool)} to ${chalk.bold(selectedDatabase)} @ ${chalk.bold(DB_READ_PROXY_HOST)}:${chalk.bold(selectedPort)}\n`)
    );

    const cliArgs = selectedTool === 'pgcli'
      ? ['-h', DB_READ_PROXY_HOST, '-p', selectedPort, '-U', DB_READ_PROXY_USER, '-d', selectedDatabase]
      : ['-h', DB_READ_PROXY_HOST, '-p', selectedPort, '-U', DB_READ_PROXY_USER, selectedDatabase];

    if (selectedTool === 'pgcli') {
      cliArgs.push('--pgclirc', pgcliConfigPath);
    }

    const dbProcess = spawn(selectedTool, cliArgs, {
      env: {
        ...process.env,
        PGPASSWORD: DB_READ_PROXY_PASSWORD,
        TZ: 'Asia/Kolkata',
        PGTZ: 'Asia/Kolkata',
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
