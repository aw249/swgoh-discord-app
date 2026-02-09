#!/bin/bash
# ===========================================
# SWGOH Discord Bot - Deployment Script
# ===========================================
# 
# Usage: ./deploy.sh [--fresh]
#   --fresh: Clean install (removes node_modules)
#
# Prerequisites:
# - Node.js 20+ installed
# - PM2 installed globally (npm install -g pm2)
# - .env file configured
# - ARM64 Comlink binary in ./bin/

set -e  # Exit on any error

# Colours for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Colour

echo -e "${BLUE}🚀 SWGOH Discord Bot - Deployment${NC}"
echo "========================================"
echo ""

# Get script directory (works even if called from elsewhere)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo -e "${BLUE}📁 Working directory: ${NC}$SCRIPT_DIR"
echo ""

# Check for .env file
if [ ! -f ".env" ]; then
    echo -e "${RED}❌ Error: .env file not found!${NC}"
    echo "   Copy .env.example to .env and configure your values:"
    echo "   cp .env.example .env"
    exit 1
fi
echo -e "${GREEN}✅ .env file found${NC}"

# Check for Comlink binary
if [ ! -f "./bin/swgoh-comlink-4.0.0" ]; then
    echo -e "${RED}❌ Error: Comlink binary not found!${NC}"
    echo "   Download the ARM64 Linux version from:"
    echo "   https://github.com/swgoh-utils/swgoh-comlink/releases"
    echo "   Save as: ./bin/swgoh-comlink-4.0.0"
    exit 1
fi

# Check Comlink binary is executable
if [ ! -x "./bin/swgoh-comlink-4.0.0" ]; then
    echo -e "${YELLOW}⚠️  Making Comlink binary executable...${NC}"
    chmod +x ./bin/swgoh-comlink-4.0.0
fi
echo -e "${GREEN}✅ Comlink binary found${NC}"

# Check for PM2
if ! command -v pm2 &> /dev/null; then
    echo -e "${RED}❌ Error: PM2 not installed!${NC}"
    echo "   Install with: npm install -g pm2"
    exit 1
fi
echo -e "${GREEN}✅ PM2 installed${NC}"

# Create logs directory
mkdir -p logs
echo -e "${GREEN}✅ Logs directory ready${NC}"

# Create data directory
mkdir -p data
echo -e "${GREEN}✅ Data directory ready${NC}"

echo ""

# Fresh install if requested
if [ "$1" == "--fresh" ]; then
    echo -e "${YELLOW}🧹 Fresh install requested - removing node_modules...${NC}"
    rm -rf node_modules
fi

# Install dependencies
echo -e "${BLUE}📦 Installing dependencies...${NC}"
npm ci --production=false
echo -e "${GREEN}✅ Dependencies installed${NC}"

echo ""

# Build TypeScript
echo -e "${BLUE}🔨 Building TypeScript...${NC}"
npm run build
echo -e "${GREEN}✅ Build complete${NC}"

echo ""

# Deploy Discord commands
echo -e "${BLUE}📝 Registering Discord commands...${NC}"
npm run deploy:commands
echo -e "${GREEN}✅ Discord commands registered${NC}"

echo ""

# Stop existing PM2 processes if running
echo -e "${BLUE}♻️  Stopping existing services...${NC}"
pm2 stop ecosystem.config.cjs 2>/dev/null || true
pm2 delete ecosystem.config.cjs 2>/dev/null || true

# Start services
echo -e "${BLUE}🚀 Starting services...${NC}"
pm2 start ecosystem.config.cjs

# Wait a moment for services to start
sleep 3

# Show status
echo ""
echo -e "${GREEN}✅ Deployment complete!${NC}"
echo ""
pm2 status

echo ""
echo -e "${BLUE}📋 Useful commands:${NC}"
echo "   pm2 logs           - View all logs"
echo "   pm2 logs swgoh-bot - View bot logs"
echo "   pm2 monit          - Monitor resources"
echo "   pm2 restart all    - Restart services"
echo "   pm2 stop all       - Stop services"
echo ""

# Save PM2 process list for auto-restart on reboot
echo -e "${BLUE}💾 Saving PM2 process list...${NC}"
pm2 save
echo -e "${GREEN}✅ PM2 processes saved${NC}"

echo ""
echo -e "${YELLOW}💡 To enable auto-start on boot, run:${NC}"
echo "   pm2 startup"
echo "   (Then run the command it outputs)"

