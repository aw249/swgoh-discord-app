# Testing Guide

This guide will walk you through setting up and testing the SWGOH Discord bot.

## Prerequisites

1. **Node.js 18+** installed
2. **A Discord account** and access to a Discord server (or create your own test server)
3. **Discord Developer Portal access** to create a bot application

## Step 1: Create a Discord Bot Application

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **"New Application"**
3. Give it a name (e.g., "SWGOH Bot Test")
4. Click **"Create"**

## Step 2: Get Bot Credentials

### Get Client ID
1. In your application, go to the **"General Information"** tab
2. Copy the **Application ID** (this is your `DISCORD_CLIENT_ID`)

### Get Bot Token
1. Go to the **"Bot"** tab
2. Click **"Add Bot"** if you haven't already
3. Under **"Token"**, click **"Reset Token"** or **"Copy"** to get your bot token (this is your `DISCORD_BOT_TOKEN`)
   - ⚠️ **Keep this secret!** Never commit it to git.

### Invite Bot to Server
1. In the Developer Portal, go to **"OAuth2"** → **"URL Generator"**
2. Select scopes:
   - ✅ `bot`
   - ✅ `applications.commands`
3. Select bot permissions:
   - ✅ `Send Messages`
   - ✅ `Use Slash Commands`
   - ✅ `Embed Links`
4. Copy the generated URL and open it in your browser
5. Select your test server and authorise the bot

## Step 3: Configure Environment Variables

1. Create a `.env` file in the project root:
   ```bash
   touch .env
   ```

2. Add your credentials (replace with your actual values):
   ```env
   DISCORD_BOT_TOKEN=your_actual_bot_token_here
   DISCORD_CLIENT_ID=your_actual_client_id_here
   SWGOH_API_KEY=placeholder_for_now
   ```

   **Note**: For now, `SWGOH_API_KEY` can be any placeholder value since the API integration is stubbed.

## Step 4: Install Dependencies

```bash
npm install
```

## Step 5: Deploy Commands

Before running the bot, you need to register the slash commands with Discord:

```bash
npm run deploy:commands
```

You should see:
```
[INFO] Started refreshing application (/) commands.
[INFO] Successfully reloaded application (/) commands.
[INFO] Commands deployed successfully.
```

## Step 6: Run the Bot

Start the bot in development mode:

```bash
npm run dev
```

You should see:
```
[INFO] Environment variables loaded successfully.
[INFO] Started refreshing application (/) commands.
[INFO] Successfully reloaded application (/) commands.
[INFO] Bot logged in as YourBotName#1234
```

The bot is now online! 🎉

## Step 7: Test Commands

In your Discord server, try the following commands:

### Test `/help`
1. Type `/help` in any channel
2. You should see an embed listing all available commands

### Test `/register`
1. Type `/register` and provide an ally code:
   ```
   /register allycode:123456789
   ```
   Or with dashes:
   ```
   /register allycode:123-456-789
   ```
2. You should see a success message confirming registration

### Test `/roster`
1. Type `/roster`
2. If you registered, you should see a roster summary (currently with mock data)
3. If you didn't register first, you'll get a friendly error suggesting to use `/register`

### Test Error Handling
1. Try `/register` with an invalid ally code (e.g., `12345` or `abc123456`)
2. You should see an error message explaining the issue

## Step 8: Run Unit Tests

Test the service layer logic:

```bash
npm test
```

You should see test results for `PlayerService`:
```
PASS  src/services/__tests__/playerService.test.ts
  PlayerService
    registerPlayer
      ✓ should register a player with a valid 9-digit ally code
      ✓ should normalise ally code by removing dashes
      ✓ should throw an error for invalid ally code format
      ...
```

## Troubleshooting

### Bot doesn't appear online
- Check that the bot token is correct in `.env`
- Verify the bot was invited to your server with proper permissions
- Check the console for error messages

### Commands don't appear
- Make sure you ran `npm run deploy:commands`
- Wait a few minutes - Discord can take time to update commands
- Try restarting Discord or using `/` to refresh the command list

### "Missing required environment variable" error
- Verify your `.env` file exists and has all required variables
- Check for typos in variable names (they must match exactly)
- Ensure there are no extra spaces around the `=` sign

### TypeScript errors
- Run `npm install` to ensure all dependencies are installed
- Run `npm run build` to check for compilation errors

## Next Steps

Once basic testing works:
1. Implement actual SWGOH API integration in `src/integrations/swgohApi.ts`
2. Replace mock data in `rosterService` with real API calls
3. Add more comprehensive error handling
4. Add database persistence (replace in-memory store)

