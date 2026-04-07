FROM node:20-slim

# Install pnpm matching workspace version
RUN npm install -g pnpm@10

WORKDIR /app

# Copy workspace manifests for layer caching
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY lib/api-zod/package.json ./lib/api-zod/
COPY lib/api-client-react/package.json ./lib/api-client-react/
COPY lib/api-spec/package.json ./lib/api-spec/
COPY lib/db/package.json ./lib/db/
COPY artifacts/api-server/package.json ./artifacts/api-server/

# Install dependencies (skip build scripts from native modules)
RUN pnpm install --frozen-lockfile --ignore-scripts

# Copy full source
COPY . .

# Build shared libs then the API server
RUN pnpm --filter @workspace/api-zod run build --if-present || true
RUN pnpm --filter @workspace/api-server run build

# Koyeb / any host injects PORT at runtime
EXPOSE 3000

CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
