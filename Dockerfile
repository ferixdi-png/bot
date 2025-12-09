# Use Node.js 24 slim as base image
FROM node:24-slim

# Set working directory
WORKDIR /app

# Install system dependencies (Python 3 and pip for running Python bot)
RUN DEBIAN_FRONTEND=noninteractive apt-get update && \
    apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create symlink for python command (some scripts expect 'python' not 'python3')
RUN ln -s /usr/bin/python3 /usr/bin/python

# Copy package files first (for better caching)
COPY package*.json ./

# Install Node.js dependencies
RUN npm ci --only=production

# Copy Python requirements
COPY requirements.txt ./

# Install Python dependencies
RUN pip3 install --no-cache-dir -r requirements.txt

# Copy all application files
COPY . .

# Set environment variables (can be overridden)
ENV NODE_ENV=production

# Start the bot
CMD ["npm", "start"]

