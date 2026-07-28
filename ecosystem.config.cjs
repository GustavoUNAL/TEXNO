const path = require('node:path');

module.exports = {
  apps: [
    {
      name: 'texno',
      script: 'src/server.js',
      cwd: path.join(__dirname),
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      kill_timeout: 5000,
      env: {
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        PORT: 3847,
      },
      max_memory_restart: '512M',
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
