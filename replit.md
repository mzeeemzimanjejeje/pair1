# Workspace

## Overview

TRUTH-MD WhatsApp Session Pairing app — pnpm workspace monorepo with a React/Vite frontend and an Express + Baileys API backend.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm (workspace) + npm (api-server)
- **TypeScript version**: 5.9
- **Frontend**: React 19 + Vite 7 + Tailwind CSS 4 (`artifacts/pairing-site`)
- **API server**: Express + @whiskeysockets/baileys (`artifacts/api-server`)
- **API client**: orval-generated TanStack Query hooks (`lib/api-client-react`)
- **Validation**: Zod

## Architecture

- **Port 5000**: Vite dev server (frontend) — the webview port
- **Port 3000**: Express API server — proxied from Vite under `/api`, `/code`, `/uptime`, `/session-status`, `/validate-session`
- The Vite config (`artifacts/pairing-site/vite.config.ts`) proxies all API routes to `localhost:3000`

## Key Commands

- `pnpm --filter @workspace/pairing-site run dev` — run Vite frontend (port 5000)
- `node artifacts/api-server/server.js` — run API server (port 3000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec

## Workflows

- **Start application** — Vite frontend on port 5000 (webview)
- **API Server** — Express backend on port 3000 (console)
