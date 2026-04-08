FROM node:20-slim

RUN npm install -g pnpm@10

WORKDIR /app

# Copy ALL workspace package.json files for proper dependency installation
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY lib/api-zod/package.json ./lib/api-zod/
COPY lib/api-client-react/package.json ./lib/api-client-react/
COPY lib/api-spec/package.json ./lib/api-spec/
COPY lib/db/package.json ./lib/db/
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY artifacts/pairing-site/package.json ./artifacts/pairing-site/

# Install all workspace dependencies
RUN pnpm install --no-frozen-lockfile --ignore-scripts

# Copy full source
COPY . .

# Single build command: builds frontend + api-server + copies frontend into dist
RUN pnpm --filter @workspace/api-server run build

EXPOSE 3000

CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
