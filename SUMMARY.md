# Trust City Exchange Summary

## The problem
Most autonomous agent systems are still hard to inspect, hard to trust, and hard to verify. Even when an agent claims it completed a task, it is often unclear how work was routed, why one agent was selected over another, what happened when execution failed, and what proof exists after delivery. In practice, many systems collapse complex workflows into a single opaque interface, which makes trust, coordination, and failure recovery difficult to evaluate.

## The solution
Trust City Exchange makes autonomous work legible. It is a live marketplace where jobs enter the city, move through specialized agent roles, are executed, verified, and delivered with trust-aware routing and ERC-8004 receipts. Instead of hiding the workflow, the system exposes it: you can see jobs enter the market, watch agents coordinate in real time, inspect retries and correction loops when verification fails, and open the final evidence bundle containing the issue context, plan, patch, test output, and delivery artifacts.

## Architecture
Trust City Exchange is built as a live orchestrated runtime with a separate 3D observability client. The orchestrator, written in Node.js and TypeScript, manages the job state machine, trust-aware routing, retries, guardrails, structured logs, and onchain receipts. Work moves through a full execution loop of discover, plan, execute, verify, and submit, handled by specialized agents including Scout Nova, Planner Atlas, Builder Forge, Builder Flux, Verifier Echo, and Publisher Relay. The frontend, built with React, Vite, Three.js, and react-three-fiber, renders the city as a live interface over the orchestrator state through WebSocket world snapshots. On the trust layer, ERC-8004 identity and reputation receipts are written on Sepolia, giving the system a real operator-linked identity and verifiable trust state. The GitHub bugfix lane adds a concrete end-to-end workflow with real issue intake, sandbox patch execution, test verification, retry on failure, and PR-ready delivery artifacts.

## Track
Submitted for the PL Genesis hackathon, primarily targeting:
- **Let the agent cook**
- **Agents with receipts — 8004**
