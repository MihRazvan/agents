# Quickstart

## Local Development

```bash
npm install
npm run dev
```

Local services:
- Orchestrator API: `http://localhost:8787`
- WebSocket stream: `ws://localhost:8787/ws`
- 3D client: `http://localhost:5173`

## Build

```bash
npm run build
```

## Key Endpoints

- `GET /health`
- `GET /state`
- `GET /jobs`
- `GET /plugins`
- `GET /onchain`
- `GET /agent.json`
- `GET /agent_log.json`
- `POST /jobs`
- `POST /plugins`

## Environment

Copy `.env.example` to `.env` and configure the values you need.

Core values:
- `OPERATOR_PRIVATE_KEY`
- `OPERATOR_WALLET`
- `FEEDBACK_CLIENT_PRIVATE_KEY`
- `FEEDBACK_CLIENT_WALLET`
- `SEPOLIA_RPC_URL`

Optional GitHub lane variable:
- `GITHUB_TOKEN`

## Live Deployment

Current live deployment:
- Frontend: https://trust-city.vercel.app
- Backend: https://trust-city.onrender.com

## Placeholder Images

Add deployment screenshots or endpoint verification screenshots here if you want:
- `../images/trust-city-quickstart-deploy.png`
