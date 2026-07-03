#!/usr/bin/env tsx
/**
 * Pre-flight guard: ensures .env.local does not reference forbidden backends.
 * Exits 1 if ollama or gemma4:26b strings are found.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const envPath = path.resolve(process.cwd(), '.env.local');

if (!fs.existsSync(envPath)) {
  process.exit(0);
}

const content = fs.readFileSync(envPath, 'utf-8');
const forbidden = ['ollama', 'gemma4:26b', 'localhost:11434'];
const found = forbidden.filter((s) => content.toLowerCase().includes(s.toLowerCase()));

if (found.length > 0) {
  console.error(`[check-env] FATAL: .env.local contains forbidden config: ${found.join(', ')}`);
  console.error(`[check-env] Only LM Studio at localhost:1234 is allowed.`);
  process.exit(1);
}

console.log('[check-env] OK — LM Studio backend confirmed.');
