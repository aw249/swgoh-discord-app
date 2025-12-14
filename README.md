# SWGOH Discord Bot

A Discord bot for Star Wars: Galaxy of Heroes, focused on Grand Arena Championship (GAC) analysis and strategy. This bot provides read-only insights to help players understand their opponents' rosters, plan defensive strategies, and optimise their GAC performance.

## Features

- **Player Registration**: Link your Discord account to your SWGOH ally code
- **Roster Analysis**: View your roster summary including Galactic Power, Galactic Legends, and key squads
- **GAC Opponent Analysis**: Compare rosters and review current opponent capabilities (coming soon)
- **GAC Strategy Planning**: Analyse opponent defensive strategies based on previous rounds (coming soon)

## Setup

### Prerequisites

- Node.js 18+ and npm
- A Discord bot application (create one at [Discord Developer Portal](https://discord.com/developers/applications))

### Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd swgoh-discord-app
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment variables:
   - Create a `.env` file in the project root
   - Fill in the following values:
     ```
     DISCORD_BOT_TOKEN=your_discord_bot_token_here
     DISCORD_CLIENT_ID=your_discord_client_id_here
     COMLINK_URL=http://localhost:3200
     ```

4. Set up SWGoH Comlink (for real-time game data):
   ```bash
   # Download the Comlink binary for your platform from:
   # https://github.com/swgoh-utils/swgoh-comlink/releases
   
   # For macOS:
   mkdir -p bin
   curl -L "https://github.com/swgoh-utils/swgoh-comlink/releases/latest/download/swgoh-comlink-macos-4.0.0.zip" -o bin/comlink.zip
   cd bin && unzip comlink.zip && chmod +x swgoh-comlink-* && cd ..
   
   # Start Comlink (run in a separate terminal):
   ./bin/swgoh-comlink-4.0.0 --port 3200
   ```

5. Build the project:
   ```bash
   npm run build
   ```

6. Deploy commands (one-time setup):
   ```bash
   npm run deploy:commands
   ```

7. Run the bot in development mode:
   ```bash
   npm run dev
   ```

   Or run the compiled version:
   ```bash
   npm start
   ```

## Data Sources

This bot uses two data sources:

### SWGoH Comlink (Primary - Recommended)
[SWGoH Comlink](https://github.com/swgoh-utils/swgoh-comlink) provides direct, real-time access to Capital Games' game APIs. This gives you:
- **Real-time data**: No delay waiting for third-party sites to update
- **GAC brackets and leaderboards**: Current season data as it happens
- **Player and guild profiles**: Full roster data including mods
- **Game events**: Current and upcoming GAC schedule

### swgoh.gg (Fallback)
The bot can also use swgoh.gg as a fallback data source, though this may experience delays when swgoh.gg hasn't updated their data after game changes.

### Testing Comlink Integration
```bash
# Ensure Comlink is running, then:
npx ts-node scripts/test-comlink.ts
```

## Commands

### `/register`
Link your Discord account to your SWGOH ally code.

**Usage**: `/register allycode:123456789`

The ally code can be provided with or without dashes (e.g., `123456789` or `123-456-789`).

### `/roster`
View your roster summary including:
- Player name
- Ally code
- Galactic Power
- Galactic Legends count
- Key squads

**Usage**: `/roster`

**Note**: You must register your ally code first using `/register`.

### `/help`
Display a list of available commands and their usage.

**Usage**: `/help`

## Development

### Project Structure

```
src/
├── bot/              # Discord bot initialisation and event handling
├── commands/         # Slash command handlers
├── services/         # Core business logic
├── integrations/     # External API clients
├── storage/          # Data persistence layer
├── utils/            # Shared utilities
└── config/           # Configuration and constants
```

### Running Tests

```bash
npm test
```

### Code Style

- TypeScript with strict mode enabled
- 2-space indentation
- Single quotes
- UK English for all user-facing text and comments

## License

ISC

