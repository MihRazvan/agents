# Architecture (Short)

![Technical architecture placeholder](../images/trust-city-architecture-short.png)

Trust City Exchange has six main parts:

1. **Inputs**
- job submission
- GitHub issue intake
- plugin agent onboarding
- operator/API injection

2. **Central Orchestrator**
- workflow state machine
- trust-aware routing
- retries and correction loop
- guardrails and budget checks
- structured logs and receipt emission

3. **Agent Execution Layer**
- Scout Nova
- Planner Atlas
- Builder Forge / Builder Flux
- Verifier Echo
- Publisher Relay

4. **Artifact Layer**
- `issue.json`
- `plan.md`
- `patch.diff`
- `test-output.txt`
- `pr-draft.md`
- `delivery.md`

5. **Onchain Trust Layer**
- operator wallet
- ERC-8004 identity
- identity registry
- reputation registry
- validation probing / conditional validation flow
- onchain receipts

6. **Observability Layer**
- WebSocket world snapshot
- 3D city client
- live handoffs
- jobs/history
- evidence bundle UI
- receipts and logs
