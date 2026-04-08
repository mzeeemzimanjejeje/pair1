# TRUTH-MD Pairing

WhatsApp session pairing server for TRUTH-MD bot.

## Deploy

[![Deploy to Heroku](https://www.herokucdn.com/deploy/button.svg)](https://heroku.com/deploy?template=https://github.com/mzeeemzimanjejeje/pair1)

## Features

- WhatsApp pairing code generation
- Session ID extraction (Base64 encoded)
- Auto-follow TRUTH-MD newsletters
- Session validation

## API Endpoints

- `GET /api/health` — Health check
- `GET /api/pair/status` — Current pairing status
- `POST /api/pair/code` — Request a new pairing code
- `POST /api/pair/entered` — Mark code as entered
- `POST /api/pair/reset` — Reset pairing session
- `GET /api/stats` — Server statistics
