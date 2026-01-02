#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load config
const configPath = path.join(__dirname, '..', 'dbconfig.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

const { environments, defaults } = config;

// Get available environments
const envFiles = fs.readdirSync(path.join(__dirname, '..'))
  .filter(f => f.startsWith('.env.') && !f.endsWith('.example'));

const availableEnvs = envFiles.map(f => f.replace('.env.', ''));
const selectedEnv = availableEnvs.includes(defaults.environment) ? defaults.environment : availableEnvs[0];

// Arguments: current_word [previous_word]
const current = process.argv[2] || '';
const previous = process.argv[3] || '';

if (previous) {
  // Second argument - database completion
  const envConfig = environments[selectedEnv];
  if (envConfig) {
    const databases = envConfig.databases.filter(db => db.startsWith(current));
    console.log(databases.join('\n'));
  }
} else {
  // First argument - port alias completion
  const envConfig = environments[selectedEnv];
  if (envConfig) {
    const aliases = Object.keys(envConfig.portAliases).filter(alias => alias.startsWith(current));
    console.log(aliases.join('\n'));
  }
}