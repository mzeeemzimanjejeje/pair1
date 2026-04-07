FROM node:20-slim

# Install pnpm
RUN npm install -g pnpm@9

WORKDIR /app

# Copy workspace manifests first for layer caching
COPY package.json pnpm-workspace.yaml ./
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY lib/api-zod/package.json ./lib/api-zod/
COPY lib/api-client-react/package.json ./lib/api-client-react/
COPY lib/db/package.json ./lib/db/
COPY scripts/package.json ./scripts/

# Copy lock file
COPY pnpm-lock.yaml ./

# Install all workspace dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY . .

# Build the API server
RUN pnpm --filter @workspace/api-server run build

# Heroku injects PORT at runtime — app already reads process.env.PORT
EXPOSE 3000

CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
