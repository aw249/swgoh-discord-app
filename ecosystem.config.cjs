/**
 * PM2 Ecosystem Configuration
 * 
 * Start all services: pm2 start ecosystem.config.cjs
 * View logs: pm2 logs
 * Stop all: pm2 stop all
 * Restart: pm2 restart all
 */
module.exports = {
  apps: [
    {
      name: 'swgoh-comlink',
      script: './bin/swgoh-comlink-4.0.0',
      args: '--port 3200 --name swgoh-discord-app',
      interpreter: 'none', // Comlink is a Go binary, not Node
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
      },
      // Restart policy
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      // Logging
      error_file: './logs/comlink-error.log',
      out_file: './logs/comlink-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
    {
      name: 'swgoh-bot',
      script: './dist/bot/index.js',
      cwd: __dirname,
      // Wait for Comlink to be ready before starting
      wait_ready: false,
      listen_timeout: 30000,
      // Environment
      env: {
        NODE_ENV: 'production',
        // Puppeteer configuration for ARM64 (Raspberry Pi)
        PUPPETEER_EXECUTABLE_PATH: '/usr/bin/chromium-browser',
        PUPPETEER_SKIP_CHROMIUM_DOWNLOAD: 'true',
      },
      // Restart policy
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      // Memory management (important for Raspberry Pi)
      max_memory_restart: '500M',
      // Logging
      error_file: './logs/bot-error.log',
      out_file: './logs/bot-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      // Graceful shutdown
      kill_timeout: 10000,
      shutdown_with_message: true,
    },
  ],
};

