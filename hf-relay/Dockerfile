# friendly-123 HF relay (owner order 2026-11-04). Hugging Face Docker Spaces expose app_port 7860 (see README front matter).
# Secrets (HF_TOKEN, ...) are Space secrets injected as env at run time; nothing secret is baked into the image.
FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server.mjs ./
# HF runs the container as uid 1000, which is the built-in "node" user.
USER node
EXPOSE 7860
CMD ["node", "server.mjs"]
