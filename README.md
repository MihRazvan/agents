# Trust City Autonomous Ops

A vertical-slice implementation of a trust-gated autonomous multi-agent system with a live 3D simulation view.

## What is implemented

- Autonomous decision loop in orchestrator: `discover -> plan -> execute -> verify -> submit`.
- Multi-agent roles: scout, planner, builder(s), verifier, publisher.
- Trust-gated handoffs using a policy threshold.
- Structured execution logs written continuously to `agent_log.json`.
- DevSpot-style capability manifest written to `agent.json`.
- Simulated ERC-8004 receipts (tx-hash-like outputs) for identity/validation/reputation events.
- Live websocket stream into a 3D city scene with moving agents, incident beacons, trails, and receipt monuments.
- Seeded procedural districts and A*-style route planning for agent movement.
- Visual trust/task overlays: trust aura rings plus live handoff beams from agents to incidents.
- Cinematic camera direction that auto-focuses high-priority incident activity.
- Reactive world ambiance (district overlays, traffic motion, stronger post-processing pipeline).

## Monorepo layout

- `apps/orchestrator`: backend autonomous runtime + websocket stream.
- `apps/sim-client`: React + Three.js live visualization.
- `packages/shared`: shared runtime types/constants.

## Quick start

```bash
npm install
npm run dev
```

Services:

- Orchestrator API: `http://localhost:8787`
- Websocket stream: `ws://localhost:8787/ws`
- 3D client: `http://localhost:5173`

## Useful endpoints

- `GET /health`
- `GET /state`
- `GET /agent.json`
- `GET /agent_log.json`

## Build

```bash
npm run build
```

## Environment variables

- `ORCHESTRATOR_PORT` (default: `8787`)
- `OPERATOR_WALLET` (default provided for local demo)
- `AGENT_ERC8004_ID` (default provided for local demo)

## Current limitation

ERC-8004 writes are currently simulated with deterministic tx-hash-style receipts for local development. The next step is wiring real contract calls on the target network used by the bounty.
