FROM node:22-alpine

# Install build tools for better-sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY server.js ./

# Create data directory
RUN mkdir -p /app/data

# Set environment variables
ENV PORT=3001
ENV DB_PATH=/app/data/flow2go.db

EXPOSE 3001

CMD ["node", "server.js"]
