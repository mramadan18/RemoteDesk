#!/bin/bash

echo "🚀 Building RemoteDesk application..."

# Build the Docker image
docker build -t remotedesk:latest .

echo "✅ Build completed!"

echo "🔧 Starting services with docker-compose..."

# Start the services
docker-compose up -d

echo "✅ Deployment completed!"
echo "🌐 Server should be running on port ${PORT:-5005}"
echo "🔍 Check logs with: docker-compose logs -f"
echo "🏥 Health check: curl http://localhost:${PORT:-5005}/health"
