# Trust City Exchange Roadmap

This roadmap is optimized for the two active bounty tracks:

- `Agent Only: Let the agent cook`
- `Agents With Receipts — 8004`

The goal is not to make the city larger. The goal is to make the system more obviously autonomous, more obviously useful, and more obviously trust-aware in a 2-minute demo.

## Product direction

`Trust City Exchange` is a trust-gated autonomous job marketplace.

Users submit jobs to the city. Trusted agents discover, plan, execute, verify, and submit those jobs. New specialist agents can plug into the city through a manifest and compete for work. ERC-8004 gives the marketplace a real identity and reputation layer.

## Current state

Already working:

- Multi-agent decision loop: `discover -> plan -> execute -> verify -> submit`
- Live 3D city with readable districts, agent movement, chat, and follow camera
- Plugin agent onboarding through manifests
- Agent manifest export in `agent.json`
- Structured logs in `agent_log.json`
- Real ERC-8004 identity registration on Sepolia
- Real ERC-8004 reputation receipts on Sepolia
- Validation authorization probing with graceful fallback when Sepolia rejects direct requests

Main gaps:

- One clearly real end-to-end job path with real external tools
- Stronger visibility into why routing and safety decisions happen
- More realistic per-agent budget and marketplace economics
- Better environment-aware movement near structures

## Phase 1: Judge-ready clarity

Target: make the existing system easy to understand in under 2 minutes.

Deliverables:

- Show job-level routing reasons and guardrail state directly in the UI
- Show why an agent was selected or rejected
- Make waiting, blocking, and retry behavior explicit
- Tighten README and submission copy around the marketplace framing
- Reduce visual clutter and keep the world focused on active work

Success criteria:

- A judge can explain the workflow after one pass through the demo
- The reason for each handoff is visible without reading the code
- The trust layer is clearly part of routing decisions

## Phase 2: One real autonomous job lane

Target: prove the city is not only a simulation.

Recommended hero flow:

- ingest a real GitHub issue or operator task
- decompose it into stages
- use real tools to produce an artifact
- verify the artifact
- submit the result and attach receipts

Strong options:

- GitHub issue -> patch -> tests -> PR summary
- landing page brief -> generated microsite -> preview deploy
- research brief -> sourced output -> evidence package

Success criteria:

- At least one job path uses real tools end-to-end
- The final artifact is inspectable by a judge
- The city view and the actual output match each other

## Phase 3: Plugin execution

Target: make `Plug in your agent` real platform behavior.

Deliverables:

- plugin manifest ingestion is already in place
- add simple plugin execution adapters such as `/plan` and `/execute`
- route at least one real subtask to a plugin agent
- show accept/reject decisions based on trust and capability

Success criteria:

- A third-party style agent can join the city and receive real work
- A plugin can be chosen over a core agent for a justified reason
- The city explains why that plugin earned the job

## Phase 4: Budget and guardrail realism

Target: make the marketplace feel economically and operationally credible.

Deliverables:

- add per-agent cost profiles
- add per-job budget ceilings
- route work using trust, capability, and cost together
- expose preflight checks before irreversible actions
- make policy failures visible in the UI and logs

Success criteria:

- Agents are not only selected by skill
- The planner can prefer cheaper or safer agents depending on the job
- Safety decisions are visible and defensible

## Phase 5: ERC-8004 expansion

Target: strengthen the receipts and trust story.

Deliverables:

- keep identity and reputation visible in the city workflow
- improve explorer-link surfacing in the UI
- if feasible, integrate the proper verifier/studio flow for validation
- use reputation more directly in routing explanations

Success criteria:

- ERC-8004 is clearly core to the marketplace, not an afterthought
- Explorer receipts are part of the demo story
- Trust affects who gets work

## Demo priorities

The demo should stay narrow and legible:

1. A job enters the city
2. Scout discovers it
3. Planner routes it
4. A specialist or plugin agent is selected for a clear reason
5. Verifier approves or bounces it back
6. Publisher submits it
7. ERC-8004 receipts are shown

## Near-term execution order

1. Make routing and guardrails explicit in the live UI
2. Update README and submission framing
3. Build one real external-tool job path
4. Add plugin execution adapters
5. Improve per-agent budget and pricing
6. Revisit movement realism and environmental avoidance
