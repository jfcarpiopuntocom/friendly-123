# Build from a git-archived checkout only. No real Opera profiles or secrets enter this image.
# Docker build may access npm registry; evidence is mounted only at docker RUN time with --network none.
FROM mcr.microsoft.com/playwright:v1.62.1-noble
WORKDIR /work
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
ENV F123_OFFLINE_SANDBOX=1
