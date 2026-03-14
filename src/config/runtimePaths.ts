import fs from 'fs';
import path from 'path';

function hasProjectMarkers(dir: string) {
  return fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'src'));
}

function unique(values: string[]) {
  return Array.from(new Set(values.map((value) => path.resolve(value))));
}

function detectProjectRoot() {
  const envRoot = process.env.APP_ROOT?.trim();
  const candidates = unique([
    envRoot || '',
    process.cwd(),
    path.resolve(__dirname, '..', '..'),
  ].filter(Boolean));

  for (const candidate of candidates) {
    if (hasProjectMarkers(candidate)) return candidate;
  }

  return path.resolve(__dirname, '..', '..');
}

export const projectRoot = detectProjectRoot();

export function resolveFromProjectRoot(...segments: string[]) {
  return path.join(projectRoot, ...segments);
}
