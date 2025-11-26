/**
 * PM2 ecosystem configuration for Delivery Print Agent
 */
module.exports = {
  apps: [
    {
      name: 'delivery-print-agent',
      script: 'index.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '200M',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
