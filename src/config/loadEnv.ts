import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { projectRoot } from './runtimePaths';

let loadedEnvPath: string | null = null;
let attempted = false;

export function loadEnv() {
  if (attempted) return loadedEnvPath;
  attempted = true;

  const candidates = Array.from(new Set([
    process.env.DOTENV_CONFIG_PATH,
    path.join(projectRoot, '.env'),
    path.join(process.cwd(), '.env'),
  ].filter((value): value is string => !!value && value.trim().length > 0)));

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    dotenv.config({ path: candidate, override: false });
    loadedEnvPath = candidate;
    break;
  }

  return loadedEnvPath;
}

export function getLoadedEnvPath() {
  return loadedEnvPath;
}
