// Production Configuration
module.exports = {
  // Server Configuration
  port: process.env.PORT || 5005,
  host: process.env.HOST || '0.0.0.0',
  
  // WebSocket Configuration
  wsPath: '/ws',
  
  // Health Check Configuration
  healthCheck: {
    interval: 30000,
    timeout: 3000,
    retries: 3
  },
  
  // CORS Configuration
  cors: {
    origin: process.env.ALLOWED_ORIGINS || '*',
    credentials: true
  }
};
