import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import {
  AGENT_COLORS,
  type AgentManifest,
  type AgentPhase,
  type AgentRole,
  type AgentRuntimeState,
  type Incident,
  type LogEntry,
  TRUST_THRESHOLD,
  type WorldSnapshot,
  type WsMessage
} from "@trust-city/shared";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../../..");

const HTTP_PORT = Number(process.env.ORCHESTRATOR_PORT ?? "8787");
const LOOP_INTERVAL_MS = 400;

const operatorWallet = process.env.OPERATOR_WALLET ?? "0xD3aDbeefD3aDbeefD3aDbeefD3aDbeefD3aDbeef";
const erc8004Identity = process.env.AGENT_ERC8004_ID ?? "agent:erc8004:trust-city-alpha";

const manifest: AgentManifest = {
  agentName: "Trust City Autonomous Ops",
  operatorWallet,
  erc8004Identity,
  supportedTools: [
    "github_api",
    "git",
    "security_scanner",
    "test_runner",
    "websocket_stream",
    "erc8004_registry_writer"
  ],
  supportedTechStacks: ["TypeScript", "React", "Three.js", "Node.js", "EVM"],
  computeConstraints: {
    maxToolCalls: 280,
    maxRuntimeSeconds: 1200,
    retryLimit: 3
  },
  supportedTaskCategories: [
    "ci_failure_response",
    "dependency_vulnerability_patch",
    "reputation_gated_multi_agent_collaboration"
  ]
};

const budget = {
  maxToolCalls: 280,
  usedToolCalls: 0,
  maxRetriesPerIncident: 3,
  maxRuntimeSeconds: 1200
};

interface IncidentWorkflow {
  stage: number;
  activeAgentId?: string;
  startedAtTick: number;
}

const stageByIndex: Array<{ key: AgentPhase; role: AgentRole; label: string }> = [
  { key: "discover", role: "scout", label: "discover" },
  { key: "plan", role: "planner", label: "plan" },
  { key: "execute", role: "builder", label: "execute" },
  { key: "verify", role: "verifier", label: "verify" },
  { key: "submit", role: "publisher", label: "submit" }
];

const agents: AgentRuntimeState[] = [
  {
    id: "agent-scout-1",
    name: "Scout Nova",
    role: "scout",
    phase: "idle",
    trustScore: 0.91,
    position: { x: -14, y: -10 },
    target: { x: -14, y: -10 },
    energy: 1
  },
  {
    id: "agent-planner-1",
    name: "Planner Atlas",
    role: "planner",
    phase: "idle",
    trustScore: 0.87,
    position: { x: -6, y: -11 },
    target: { x: -6, y: -11 },
    energy: 1
  },
  {
    id: "agent-builder-1",
    name: "Builder Forge",
    role: "builder",
    phase: "idle",
    trustScore: 0.74,
    position: { x: 0, y: -11 },
    target: { x: 0, y: -11 },
    energy: 1
  },
  {
    id: "agent-builder-2",
    name: "Builder Flux",
    role: "builder",
    phase: "idle",
    trustScore: 0.63,
    position: { x: 4, y: -10 },
    target: { x: 4, y: -10 },
    energy: 1
  },
  {
    id: "agent-verifier-1",
    name: "Verifier Echo",
    role: "verifier",
    phase: "idle",
    trustScore: 0.89,
    position: { x: 8, y: -10 },
    target: { x: 8, y: -10 },
    energy: 1
  },
  {
    id: "agent-publisher-1",
    name: "Publisher Relay",
    role: "publisher",
    phase: "idle",
    trustScore: 0.9,
    position: { x: 12, y: -10 },
    target: { x: 12, y: -10 },
    energy: 1
  }
];

const incidents: Incident[] = [];
const workflows = new Map<string, IncidentWorkflow>();
const logs: LogEntry[] = [];
const receipts: string[] = [];

let tick = 0;
let loopStartedAt = Date.now();

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

function makeTxHash(): string {
  return `0x${randomBytes(32).toString("hex")}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function broadcast<T>(message: WsMessage<T>): void {
  const payload = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(payload);
    }
  }
}

function trimLogs(): void {
  if (logs.length > 1500) {
    logs.splice(0, logs.length - 1500);
  }
}

async function persistArtifacts(): Promise<void> {
  await Promise.all([
    writeFile(path.join(rootDir, "agent.json"), JSON.stringify(manifest, null, 2)),
    writeFile(path.join(rootDir, "agent_log.json"), JSON.stringify(logs, null, 2))
  ]);
}

function addLog(
  type: LogEntry["type"],
  actor: string,
  message: string,
  context?: Record<string, unknown>
): void {
  const entry: LogEntry = {
    id: randomUUID(),
    timestamp: nowIso(),
    tick,
    type,
    actor,
    message,
    context
  };
  logs.push(entry);
  trimLogs();
  broadcast({ type: "log_entry", payload: entry });
  void persistArtifacts();
}

function getSnapshot(): WorldSnapshot {
  return {
    timestamp: nowIso(),
    tick,
    budget,
    receipts,
    agents,
    incidents
  };
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function findAgentsByRole(role: AgentRole): AgentRuntimeState[] {
  return agents
    .filter((agent) => agent.role === role)
    .sort((a, b) => b.trustScore - a.trustScore);
}

function setAgentIdle(agentId?: string): void {
  if (!agentId) {
    return;
  }
  const agent = agents.find((candidate) => candidate.id === agentId);
  if (!agent) {
    return;
  }
  agent.phase = "idle";
  agent.assignedIncidentId = undefined;
  const hubX =
    agent.role === "scout"
      ? -14
      : agent.role === "planner"
        ? -6
        : agent.role === "builder"
          ? 1
          : agent.role === "verifier"
            ? 8
            : 12;
  agent.target = { x: hubX, y: -10 };
}

function allocateStageAgent(incident: Incident, workflow: IncidentWorkflow): AgentRuntimeState | null {
  const step = stageByIndex[workflow.stage];
  const preferred = findAgentsByRole(step.role);
  const candidate = preferred.find((agent) => agent.trustScore >= TRUST_THRESHOLD) ?? null;

  if (!candidate) {
    addLog("safety", "policy-engine", "Trust gate blocked handoff", {
      incidentId: incident.id,
      requiredRole: step.role,
      threshold: TRUST_THRESHOLD,
      availableAgents: preferred.map((agent) => ({ id: agent.id, trustScore: agent.trustScore }))
    });
    return null;
  }

  candidate.phase = step.key;
  candidate.assignedIncidentId = incident.id;
  candidate.target = incident.position;
  workflow.activeAgentId = candidate.id;
  incident.ownerAgentId = candidate.id;
  incident.status = "in_progress";

  addLog("decision", candidate.id, `Assigned ${step.label} stage to ${candidate.name}`, {
    incidentId: incident.id,
    stage: workflow.stage,
    trustScore: candidate.trustScore,
    color: AGENT_COLORS[candidate.role]
  });

  return candidate;
}

function stageFailureChance(stage: number, incident: Incident): number {
  const base = incident.severity === "high" ? 0.23 : incident.severity === "medium" ? 0.16 : 0.1;
  return Math.min(0.45, base + stage * 0.04);
}

function runToolCall(step: { label: string; key: AgentPhase }, actor: AgentRuntimeState, incident: Incident): boolean {
  budget.usedToolCalls += 1;

  addLog("tool_call", actor.id, `Toolchain execution for ${step.label}`, {
    incidentId: incident.id,
    tool: `${step.key}_toolchain_v1`,
    usedToolCalls: budget.usedToolCalls,
    maxToolCalls: budget.maxToolCalls
  });

  const failed = Math.random() < stageFailureChance(workflows.get(incident.id)?.stage ?? 0, incident);

  if (!failed) {
    return true;
  }

  incident.retries += 1;
  addLog("retry", actor.id, "Execution failed, retry scheduled", {
    incidentId: incident.id,
    retries: incident.retries,
    retryLimit: budget.maxRetriesPerIncident
  });

  if (incident.retries > budget.maxRetriesPerIncident) {
    incident.status = "failed";
    addLog("failure", actor.id, "Incident marked failed after retry budget exhausted", {
      incidentId: incident.id,
      retries: incident.retries
    });
  }

  return false;
}

function emitReceipt(action: string, incidentId?: string): string {
  const txHash = makeTxHash();
  receipts.push(txHash);
  if (receipts.length > 80) {
    receipts.splice(0, receipts.length - 80);
  }
  addLog("onchain", "erc8004-writer", `Onchain ${action} receipt committed`, {
    txHash,
    incidentId
  });
  broadcast({ type: "receipt", payload: { txHash, action, incidentId, timestamp: nowIso() } });
  return txHash;
}

function completeStage(incident: Incident, workflow: IncidentWorkflow): void {
  const step = stageByIndex[workflow.stage];
  const actor = agents.find((agent) => agent.id === workflow.activeAgentId);
  if (!actor) {
    return;
  }

  const success = runToolCall(step, actor, incident);
  if (!success) {
    if (incident.status === "failed") {
      setAgentIdle(actor.id);
      workflow.activeAgentId = undefined;
    }
    return;
  }

  incident.timeline.push(`${step.label}@${nowIso()}`);
  addLog("output", actor.id, `Stage completed: ${step.label}`, {
    incidentId: incident.id,
    stage: workflow.stage
  });

  if (step.key === "verify") {
    emitReceipt("validation_registry_write", incident.id);
  }

  if (step.key === "submit") {
    incident.status = "resolved";
    emitReceipt("reputation_registry_update", incident.id);
    addLog("output", actor.id, "Incident resolved and submitted", {
      incidentId: incident.id,
      finalTimeline: incident.timeline
    });
    broadcast({ type: "incident_resolved", payload: incident });
    setAgentIdle(actor.id);
    workflow.activeAgentId = undefined;
    workflow.stage = stageByIndex.length;
    return;
  }

  setAgentIdle(actor.id);
  workflow.stage += 1;
  workflow.activeAgentId = undefined;
}

function tickMovement(): void {
  for (const agent of agents) {
    const dx = agent.target.x - agent.position.x;
    const dy = agent.target.y - agent.position.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 0.001) {
      continue;
    }
    const step = Math.min(0.38, dist);
    agent.position.x += (dx / dist) * step;
    agent.position.y += (dy / dist) * step;
    agent.energy = Math.max(0.2, Math.min(1, agent.energy + (agent.phase === "idle" ? 0.01 : -0.004)));
  }
}

function randomIncidentPosition(): { x: number; y: number } {
  return {
    x: -16 + Math.random() * 32,
    y: -1 + Math.random() * 16
  };
}

function spawnIncident(): Incident {
  const categories: Incident["category"][] = ["ci_failure", "security_vuln", "api_regression"];
  const severities: Incident["severity"][] = ["low", "medium", "high"];
  const category = categories[Math.floor(Math.random() * categories.length)];
  const severity = severities[Math.floor(Math.random() * severities.length)];

  const incident: Incident = {
    id: `incident-${randomUUID().slice(0, 8)}`,
    title:
      category === "ci_failure"
        ? "Pipeline red on default branch"
        : category === "security_vuln"
          ? "Critical dependency CVE detected"
          : "API regression in production route",
    category,
    severity,
    status: "open",
    position: randomIncidentPosition(),
    retries: 0,
    timeline: []
  };

  incidents.push(incident);
  workflows.set(incident.id, { stage: 0, startedAtTick: tick });
  addLog("decision", "scout-controller", "New incident discovered", {
    incidentId: incident.id,
    category,
    severity
  });
  broadcast({ type: "incident_spawned", payload: incident });
  return incident;
}

function processIncidents(): void {
  for (const incident of incidents) {
    const workflow = workflows.get(incident.id);
    if (!workflow) {
      continue;
    }

    if (incident.status === "resolved" || incident.status === "failed") {
      continue;
    }

    if (budget.usedToolCalls >= budget.maxToolCalls) {
      incident.status = "failed";
      addLog("safety", "budget-guard", "Incident aborted due to tool-call budget exhaustion", {
        incidentId: incident.id,
        usedToolCalls: budget.usedToolCalls
      });
      continue;
    }

    if (workflow.stage >= stageByIndex.length) {
      continue;
    }

    if (!workflow.activeAgentId) {
      const assigned = allocateStageAgent(incident, workflow);
      if (!assigned) {
        incident.retries += 1;
        if (incident.retries > budget.maxRetriesPerIncident) {
          incident.status = "failed";
          addLog("failure", "policy-engine", "Incident failed after trust gate retries", {
            incidentId: incident.id,
            retries: incident.retries
          });
        }
      }
      continue;
    }

    const actor = agents.find((agent) => agent.id === workflow.activeAgentId);
    if (!actor) {
      workflow.activeAgentId = undefined;
      continue;
    }

    if (distance(actor.position, incident.position) < 0.75) {
      completeStage(incident, workflow);
    }
  }
}

function runtimeGuardrails(): void {
  const runtimeSeconds = (Date.now() - loopStartedAt) / 1000;
  if (runtimeSeconds > budget.maxRuntimeSeconds) {
    addLog("safety", "runtime-guard", "Runtime budget reached; holding incident intake", {
      runtimeSeconds,
      maxRuntimeSeconds: budget.maxRuntimeSeconds
    });
  }
}

function mainLoop(): void {
  tick += 1;

  if (tick === 1) {
    emitReceipt("identity_registry_registration");
    emitReceipt("operator_link_validation");
    spawnIncident();
  }

  if (tick % 80 === 0 && incidents.filter((incident) => incident.status === "open" || incident.status === "in_progress").length < 3) {
    spawnIncident();
  }

  runtimeGuardrails();
  processIncidents();
  tickMovement();

  const snapshot = getSnapshot();
  broadcast({ type: "world_snapshot", payload: snapshot });

  if (tick % 10 === 0) {
    addLog("state", "system", "Periodic state checkpoint", {
      openIncidents: incidents.filter((incident) => incident.status === "open" || incident.status === "in_progress").length,
      resolvedIncidents: incidents.filter((incident) => incident.status === "resolved").length,
      failedIncidents: incidents.filter((incident) => incident.status === "failed").length,
      budget
    });
  }
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, tick, wsClients: wss.clients.size });
});

app.get("/state", (_req, res) => {
  res.json(getSnapshot());
});

app.get("/agent.json", (_req, res) => {
  res.json(manifest);
});

app.get("/agent_log.json", (_req, res) => {
  res.json(logs);
});

wss.on("connection", (socket) => {
  socket.send(JSON.stringify({ type: "world_snapshot", payload: getSnapshot() }));
});

server.listen(HTTP_PORT, async () => {
  await persistArtifacts();
  addLog("decision", "system", "Orchestrator online", {
    port: HTTP_PORT,
    trustThreshold: TRUST_THRESHOLD,
    stagePipeline: stageByIndex.map((stage) => stage.label)
  });
  setInterval(mainLoop, LOOP_INTERVAL_MS);
});
