FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Expose port (will be overridden by environment variable)
EXPOSE 5005

# Set environment variables
ENV NODE_ENV=production
ENV HOST=0.0.0.0

# Health check - fixed syntax
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "const port = process.env.PORT || 5005; require('http').get('http://localhost:' + port + '/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# Start the server
CMD ["npm", "run", "server"]
