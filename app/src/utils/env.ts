import dotenv from 'dotenv';
import { logger } from './logger';

dotenv.config();

interface EnvVars {
  DISCORD_BOT_TOKEN: string;
  DISCORD_CLIENT_ID: string;
  SWGOH_API_KEY: string;
}

function getEnvVar(key: keyof EnvVars): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export function loadEnv(): EnvVars {
  try {
    return {
      DISCORD_BOT_TOKEN: getEnvVar('DISCORD_BOT_TOKEN'),
      DISCORD_CLIENT_ID: getEnvVar('DISCORD_CLIENT_ID'),
      SWGOH_API_KEY: getEnvVar('SWGOH_API_KEY')
    };
  } catch (error) {
    logger.error('Failed to load environment variables:', error);
    throw error;
  }
}

