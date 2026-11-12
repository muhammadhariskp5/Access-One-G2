// pm2 process definition for production.
//   npm ci && npm run build && pm2 startOrReload ecosystem.config.cjs && pm2 save
// Runs the compiled bundle (not TypeScript via tsx). Secrets come from .env next to this file.
module.exports = {
  apps: [
    {
      name: 'accessone',
      script: 'build/server.cjs',
      cwd: __dirname,
      node_args: '--enable-source-maps',
      // One process: the realtime hub, rate limiter and job lock are in-memory/single-instance.
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      max_memory_restart: '600M',
      time: true
    }
  ]
};
