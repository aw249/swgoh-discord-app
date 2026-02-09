# Raspberry Pi 5 Deployment Guide

This guide covers deploying the SWGOH Discord Bot to a Raspberry Pi 5 running Raspberry Pi OS (64-bit).

## Prerequisites

- Raspberry Pi 5 (4GB or 8GB recommended)
- Raspberry Pi OS 64-bit (Bookworm or later)
- SSH access to your Pi
- Internet connection

---

## 1. Initial System Setup

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install essential build tools
sudo apt install -y build-essential git curl
```

## 2. Install Node.js 20 LTS (ARM64)

```bash
# Install Node.js using NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installation
node --version   # Should show v20.x.x
npm --version    # Should show 10.x.x
```

## 3. Install System Dependencies

The bot uses `canvas` (for image generation) and `puppeteer` (for web scraping), which require system libraries:

```bash
# For node-canvas
sudo apt install -y \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    libpixman-1-dev

# For Puppeteer/Chromium on ARM64
sudo apt install -y chromium-browser chromium-codecs-ffmpeg
```

## 4. Install PM2 (Process Manager)

```bash
# Install PM2 globally
sudo npm install -g pm2

# Verify installation
pm2 --version
```

## 5. Clone the Repository

```bash
# Clone to home directory
cd ~
git clone <your-repo-url> swgoh-discord-app
cd swgoh-discord-app
```

## 6. Download ARM64 Comlink Binary

The Comlink binary included in the repo is for macOS. You need the Linux ARM64 version:

```bash
# Create bin directory
mkdir -p bin

# Download the ARM64 Linux version
# Check https://github.com/swgoh-utils/swgoh-comlink/releases for latest version
wget https://github.com/swgoh-utils/swgoh-comlink/releases/download/v4.0.0/swgoh-comlink-linux-arm64 \
    -O bin/swgoh-comlink-4.0.0

# Make it executable
chmod +x bin/swgoh-comlink-4.0.0

# Verify it runs
./bin/swgoh-comlink-4.0.0 --version
```

> **Note:** If the above URL doesn't work, visit the releases page and download the appropriate ARM64 Linux binary manually.

## 7. Configure Environment Variables

```bash
# Copy the example configuration
cp .env.example .env

# Edit with your values
nano .env
```

Required values:
- `DISCORD_BOT_TOKEN` - From Discord Developer Portal
- `DISCORD_CLIENT_ID` - Your bot's application ID
- `SWGOH_API_KEY` - From swgoh.gg (if using their API)

For Raspberry Pi, also uncomment/add:
```bash
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
```

## 8. Deploy the Bot

```bash
# Run the deployment script
./deploy.sh

# Or if you prefer npm scripts
npm run deploy
```

The deployment script will:
1. ✅ Verify configuration files
2. ✅ Install dependencies
3. ✅ Build TypeScript
4. ✅ Register Discord commands
5. ✅ Start services via PM2
6. ✅ Save PM2 process list

## 9. Enable Auto-Start on Boot

```bash
# Generate startup script
pm2 startup

# PM2 will output a command like:
# sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u pi --hp /home/pi

# Run the command it gives you, then:
pm2 save
```

Now the bot will automatically start when the Pi boots.

---

## Useful Commands

### PM2 Process Management

```bash
pm2 status              # Show all processes
pm2 logs                # View all logs (Ctrl+C to exit)
pm2 logs swgoh-bot      # View bot logs only
pm2 logs swgoh-comlink  # View Comlink logs only
pm2 monit               # Real-time monitoring dashboard
pm2 restart all         # Restart all services
pm2 stop all            # Stop all services
pm2 delete all          # Remove all services
```

### Updating the Bot

```bash
cd ~/swgoh-discord-app

# Pull latest changes
git pull

# Run deployment
./deploy.sh
```

### Checking Service Health

```bash
# Check if Comlink is responding
curl -s http://localhost:3200/metadata -X POST -H "Content-Type: application/json" -d '{"payload":{}}' | head -c 100

# Check memory usage
free -h

# Check disk usage
df -h
```

---

## Memory Optimisation (Optional)

If you have the 4GB model and experience memory issues:

### Add Swap Space

```bash
# Create 2GB swap file
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Make permanent
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### Adjust PM2 Memory Limits

Edit `ecosystem.config.cjs`:
```javascript
max_memory_restart: '400M',  // Lower if needed
```

---

## Troubleshooting

### Bot won't start

1. Check logs: `pm2 logs swgoh-bot`
2. Verify `.env` file exists and has valid values
3. Ensure Comlink is running: `pm2 logs swgoh-comlink`

### Comlink won't start

1. Check if another process is using port 3200: `lsof -i :3200`
2. Verify the binary is executable: `ls -la bin/swgoh-comlink-4.0.0`
3. Check if it's the correct architecture: `file bin/swgoh-comlink-4.0.0`

### Puppeteer/Chromium errors

1. Verify Chromium is installed: `chromium-browser --version`
2. Check environment variable: `echo $PUPPETEER_EXECUTABLE_PATH`
3. Ensure `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true` is set

### Out of memory

1. Check memory: `free -h`
2. Add swap space (see above)
3. Reduce PM2 `max_memory_restart` setting
4. Close other running services

---

## Security Notes

- Never commit your `.env` file
- Keep your Discord bot token secret
- Consider using `ufw` to restrict network access if the Pi is publicly accessible
- Regularly update: `sudo apt update && sudo apt upgrade -y`

---

## Support

For issues specific to:
- **Discord.js**: https://discord.js.org/
- **Comlink**: https://github.com/swgoh-utils/swgoh-comlink
- **PM2**: https://pm2.keymetrics.io/docs/

