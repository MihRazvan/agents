# Trust City Exchange

Trust City Exchange is a trust-gated autonomous job marketplace visualized as a live 3D city.

Jobs enter the city, specialized agents discover and claim them, trusted agents collaborate to complete them, and the system publishes verifiable ERC-8004 receipts where possible.

## What it does

- Runs a full agent workflow: `discover -> plan -> execute -> verify -> submit`
- Visualizes the workflow in a 3D city with live movement, chat, and camera follow
- Routes jobs using trust, skills, tools, and availability
- Supports plugin agents joining the city through a manifest
- Exports `agent.json` and `agent_log.json` for hackathon compatibility
- Writes real ERC-8004 identity and reputation receipts on Ethereum Sepolia

## Monorepo layout

- `apps/orchestrator`: autonomous runtime, APIs, WebSocket stream, onchain integration
- `apps/sim-client`: React + Three.js visualization client
- `packages/shared`: shared domain types and constants

## Quick start

```bash
npm install
npm run dev
```

Services:

- Orchestrator API: `http://localhost:8787`
- WebSocket stream: `ws://localhost:8787/ws`
- 3D client: `http://localhost:5173`

## Useful endpoints

- `GET /health`
- `GET /state`
- `GET /jobs`
- `GET /plugins`
- `GET /onchain`
- `GET /agent.json`
- `GET /agent_log.json`
- `POST /jobs`

## Environment

Copy `.env.example` to `.env` and configure:

- `OPERATOR_PRIVATE_KEY`
- `OPERATOR_WALLET`
- `FEEDBACK_CLIENT_PRIVATE_KEY`
- `FEEDBACK_CLIENT_WALLET`
- `SEPOLIA_RPC_URL`

The operator wallet owns the city agent identity. The feedback wallet is used for ERC-8004 reputation writes, because self-feedback is rejected by the reputation registry.

Optional GitHub hero-lane vars:

- `GITHUB_OWNER`
- `GITHUB_REPO`
- `GITHUB_ISSUE_NUMBER`
- `GITHUB_TOKEN`

When these are set, the GitHub bugfix lane fetches a real issue from the GitHub API and includes that payload in the execution bundle. When they are not set, the lane still runs against the built-in demo issue queue.

## Onchain status

Currently implemented:

- Identity registration: live on Sepolia
- Reputation receipts: live on Sepolia
- Validation probing: implemented, but direct public Sepolia validation writes are rejected without an authorized verifier flow

## Roadmap

The active build plan is in [ROADMAP.md](./ROADMAP.md).

Current priority:

1. Make routing and guardrails explicit in the live UI
2. Add one clearly real end-to-end job path with real external tools
3. Route real work to plugin agents through a simple adapter flow

## Build

```bash
npm run build
```

## Submit a job manually

You can inject a new marketplace job directly into the city:

```bash
curl -X POST http://localhost:8787/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Patch wallet connect regression",
    "summary": "Investigate the wallet banner regression and produce a tested remediation patch.",
    "category": "github_bugfix",
    "priority": "priority",
    "source": "github",
    "submitter": "Operator Console",
    "requestedSkills": ["TypeScript", "debugging", "tests"],
    "requiredTools": ["github_api", "git", "test_runner"],
    "requiredTrust": 0.74,
    "deliverable": "Patch artifact with test evidence"
  }'
```

This job will be routed through the same city workflow as the seeded jobs.
