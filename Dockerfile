# Simple WhatsApp Web.js devcontainer
FROM node:20-bullseye

# Install essential dependencies for development including Python
RUN apt-get update && apt-get install -y \
    chromium \
    git \
    curl \
    wget \
    python3 \
    python3-pip \
    python3-venv \
    ca-certificates \
    fonts-liberation \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libgbm1 \
    libx11-xcb1 \
    libasound2 \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Set up workspace
WORKDIR /app

# Copy and install Python requirements if they exist
COPY requirements.txt* ./
RUN if [ -f requirements.txt ]; then pip3 install -r requirements.txt; fi

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Install npm dependencies
RUN npm install

# Create necessary directories
RUN mkdir -p /app/.wwebjs_auth /app/downloads /app/logs

# Set environment variables for Puppeteer
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV NODE_ENV=development


# Create directories
RUN mkdir -p .wwebjs_auth downloads logs

# Copy application source code
COPY . .

EXPOSE 5005

CMD ["npm", "start"]