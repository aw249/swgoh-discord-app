import { GatewayIntentBits } from 'discord.js';

export const DISCORD_INTENTS = [
  GatewayIntentBits.Guilds
];

export interface DiscordConfig {
  token: string;
  clientId: string;
}

