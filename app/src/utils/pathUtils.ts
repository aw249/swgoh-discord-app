import { join, dirname, resolve } from 'path';

/**
 * Get the project root directory (the 'app' folder).
 * This works regardless of where the process is started from.
 * 
 * When compiled, code runs from dist/, so we go up from dist to app.
 * When running with ts-node, we go up from src to app.
 */
export function getProjectRoot(): string {
  // In compiled JavaScript, __dirname will be something like:
  // /path/to/discord-bot/app/dist/storage or /path/to/discord-bot/app/dist/utils
  // We need to go up to the 'app' directory
  
  // Check if we're in dist/ (compiled) or src/ (ts-node)
  const currentDir = __dirname;
  
  // Normalize path separators (handle both / and \)
  const normalized = currentDir.replace(/\\/g, '/');
  
  // If we're in dist/, go up to app/
  const distMatch = normalized.match(/^(.+?)\/dist\//);
  if (distMatch) {
    return resolve(distMatch[1]);
  }
  
  // If we're in src/, go up to app/
  const srcMatch = normalized.match(/^(.+?)\/src\//);
  if (srcMatch) {
    return resolve(srcMatch[1]);
  }
  
  // Fallback: try to find app/ directory by going up
  // This handles edge cases where the structure might be different
  const parts = normalized.split('/');
  const appIndex = parts.lastIndexOf('app');
  if (appIndex >= 0) {
    return resolve(parts.slice(0, appIndex + 1).join('/'));
  }
  
  // Last resort: use process.cwd() but warn
  console.warn('Warning: Could not determine project root from __dirname, using process.cwd()');
  return process.cwd();
}

/**
 * Get a path relative to the project root.
 * @param relativePath - Path relative to the project root (e.g., 'data/players.json')
 */
export function getProjectPath(relativePath: string): string {
  return join(getProjectRoot(), relativePath);
}

