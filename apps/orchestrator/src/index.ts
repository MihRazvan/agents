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
  INCIDENT_ROUTING,
  ROLE_HUBS,
  type AgentManifest,
  type AgentPhase,
  type AgentRole,
  type AgentRuntimeState,
  type District,
  type Incident,
  type LogEntry,
  TRUST_THRESHOLD,
  type Vec2,
  type WorldSnapshot,
  type WsMessage
} from "@trust-city/shared";
import { createNavigation } from "./navigation.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../../..");

const HTTP_PORT = Number(process.env.ORCHESTRATOR_PORT ?? "8787");
const LOOP_INTERVAL_MS = 400;
const WORLD_SEED = Number(process.env.WORLD_SEED ?? "271828");

const operatorWallet = process.env.OPERATOR_WALLET ?? "0xD3aDbeefD3aDbeefD3aDbeefD3aDbeefD3aDbeef";
const erc8004Identity = process.env.AGENT_ERC8004_ID ?? "agent:erc8004:trust-city-alpha";

const GRID_MIN = -128;
const GRID_MAX = 128;
const GRID_STEP = 1;
const ROAD_MAJOR_SPACING = 24;
const ROAD_MINOR_SPACING = 12;
const ROAD_MAJOR_HALF_WIDTH = 2;
const ROAD_MINOR_HALF_WIDTH = 1;

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
    "erc8004_registry_writer",
    "path_router"
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

const rng = mulberry32(WORLD_SEED);
const districts = buildDistricts();
const navigation = createNavigation({
  worldSeed: WORLD_SEED,
  gridMin: GRID_MIN,
  gridMax: GRID_MAX,
  gridStep: GRID_STEP,
  roadMajorSpacing: ROAD_MAJOR_SPACING,
  roadMinorSpacing: ROAD_MINOR_SPACING,
  roadMajorHalfWidth: ROAD_MAJOR_HALF_WIDTH,
  roadMinorHalfWidth: ROAD_MINOR_HALF_WIDTH
});

function hubPoint(role: AgentRole, offset?: Vec2): Vec2 {
  return {
    x: ROLE_HUBS[role].position.x + (offset?.x ?? 0),
    y: ROLE_HUBS[role].position.y + (offset?.y ?? 0)
  };
}

const agents: AgentRuntimeState[] = [
  {
    id: "agent-scout-1",
    name: "Scout Nova",
    role: "scout",
    phase: "idle",
    trustScore: 0.91,
    position: hubPoint("scout"),
    target: hubPoint("scout"),
    path: [],
    energy: 1,
    speed: 1.24
  },
  {
    id: "agent-planner-1",
    name: "Planner Atlas",
    role: "planner",
    phase: "idle",
    trustScore: 0.87,
    position: hubPoint("planner"),
    target: hubPoint("planner"),
    path: [],
    energy: 1,
    speed: 1.04
  },
  {
    id: "agent-builder-1",
    name: "Builder Forge",
    role: "builder",
    phase: "idle",
    trustScore: 0.74,
    position: hubPoint("builder"),
    target: hubPoint("builder"),
    path: [],
    energy: 1,
    speed: 0.94
  },
  {
    id: "agent-builder-2",
    name: "Builder Flux",
    role: "builder",
    phase: "idle",
    trustScore: 0.63,
    position: hubPoint("builder", { x: 12, y: 0 }),
    target: hubPoint("builder", { x: 12, y: 0 }),
    path: [],
    energy: 1,
    speed: 0.9
  },
  {
    id: "agent-verifier-1",
    name: "Verifier Echo",
    role: "verifier",
    phase: "idle",
    trustScore: 0.89,
    position: hubPoint("verifier"),
    target: hubPoint("verifier"),
    path: [],
    energy: 1,
    speed: 0.98
  },
  {
    id: "agent-publisher-1",
    name: "Publisher Relay",
    role: "publisher",
    phase: "idle",
    trustScore: 0.9,
    position: hubPoint("publisher"),
    target: hubPoint("publisher"),
    path: [],
    energy: 1,
    speed: 1.08
  }
];

const incidents: Incident[] = [];
const workflows = new Map<string, IncidentWorkflow>();
const logs: LogEntry[] = [];
const receipts: string[] = [];

let tick = 0;
let loopStartedAt = Date.now();
let cinematicFocus: string | undefined;

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
    worldSeed: WORLD_SEED,
    budget,
    districts,
    cinematicFocus,
    receipts,
    agents,
    incidents
  };
}

function buildDistricts(): District[] {
  const districtDefs = [
    {
      name: "Core Nexus",
      theme: "core" as const,
      center: { x: ROLE_HUBS.verifier.position.x - 8, y: ROLE_HUBS.verifier.position.y + 24 }
    },
    {
      name: "Forge Quarter",
      theme: "industrial" as const,
      center: { x: ROLE_HUBS.builder.position.x + 18, y: ROLE_HUBS.builder.position.y - 24 }
    },
    {
      name: "Helix Labs",
      theme: "research" as const,
      center: { x: ROLE_HUBS.planner.position.x - 12, y: ROLE_HUBS.planner.position.y + 24 }
    },
    {
      name: "Lumen Habitat",
      theme: "residential" as const,
      center: { x: ROLE_HUBS.publisher.position.x - 8, y: ROLE_HUBS.publisher.position.y + 30 }
    }
  ];

  return districtDefs.map((item, index) => {
    const jitterScale = 2 + index;
    return {
      id: `district-${index + 1}`,
      name: item.name,
      center: {
        x: item.center.x + (rng() * 2 - 1) * jitterScale,
        y: item.center.y + (rng() * 2 - 1) * jitterScale
      },
      radius: 10 + rng() * 4,
      theme: item.theme,
      riskLevel: 0.45 + rng() * 0.5
    };
  });
}

function setAgentDestination(agent: AgentRuntimeState, destination: Vec2): void {
  const safeDestination = navigation.ensureWalkable(destination);
  const path = navigation.planPath(agent.position, safeDestination);
  agent.path = path;
  agent.target = path[0] ?? safeDestination;
}

function findAgentsByRole(role: AgentRole): AgentRuntimeState[] {
  return agents
    .filter((agent) => agent.role === role)
    .sort((a, b) => b.trustScore - a.trustScore);
}

function findIdleAgentsByRole(role: AgentRole): AgentRuntimeState[] {
  return findAgentsByRole(role).filter((agent) => agent.phase === "idle" && !agent.assignedIncidentId);
}

function roleHubPosition(role: AgentRole): Vec2 {
  return hubPoint(role);
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
  setAgentDestination(agent, roleHubPosition(agent.role));
}

function allocateStageAgent(incident: Incident, workflow: IncidentWorkflow): AgentRuntimeState | null {
  const step = stageByIndex[workflow.stage];
  const preferred = findAgentsByRole(step.role);
  const available = findIdleAgentsByRole(step.role);
  const candidate = available.find((agent) => agent.trustScore >= TRUST_THRESHOLD) ?? null;

  if (!candidate) {
    cinematicFocus = incident.id;
    addLog("safety", "policy-engine", "Trust gate blocked handoff", {
      incidentId: incident.id,
      requiredRole: step.role,
      threshold: TRUST_THRESHOLD,
      availableAgents: available.map((agent) => ({ id: agent.id, trustScore: agent.trustScore })),
      busyAgents: preferred
        .filter((agent) => !available.includes(agent))
        .map((agent) => ({ id: agent.id, trustScore: agent.trustScore, phase: agent.phase, assignedIncidentId: agent.assignedIncidentId }))
    });
    return null;
  }

  candidate.phase = step.key;
  candidate.assignedIncidentId = incident.id;
  setAgentDestination(candidate, incident.position);
  workflow.activeAgentId = candidate.id;
  incident.ownerAgentId = candidate.id;
  incident.status = "in_progress";
  cinematicFocus = incident.id;

  addLog("decision", candidate.id, `Assigned ${step.label} stage to ${candidate.name}`, {
    incidentId: incident.id,
    stage: workflow.stage,
    trustScore: candidate.trustScore,
    color: AGENT_COLORS[candidate.role],
    routePoints: candidate.path.length
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
    tool: `${step.key}_toolchain_v2`,
    usedToolCalls: budget.usedToolCalls,
    maxToolCalls: budget.maxToolCalls
  });

  const failed = Math.random() < stageFailureChance(workflows.get(incident.id)?.stage ?? 0, incident);

  if (!failed) {
    return true;
  }

  incident.retries += 1;
  cinematicFocus = incident.id;

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
    cinematicFocus = incident.id;
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
    if (agent.path.length === 0) {
      agent.energy = Math.max(0.2, Math.min(1, agent.energy + (agent.phase === "idle" ? 0.008 : -0.002)));
      continue;
    }

    const waypoint = agent.path[0];
    agent.target = waypoint;

    const dx = waypoint.x - agent.position.x;
    const dy = waypoint.y - agent.position.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist <= agent.speed) {
      agent.position.x = waypoint.x;
      agent.position.y = waypoint.y;
      agent.path.shift();
    } else if (dist > 0.0001) {
      agent.position.x += (dx / dist) * agent.speed;
      agent.position.y += (dy / dist) * agent.speed;
    }

    agent.energy = Math.max(0.2, Math.min(1, agent.energy + (agent.phase === "idle" ? 0.008 : -0.005)));
  }
}

function pickDistrictForCategory(category: Incident["category"]): District {
  const preferredThemes = INCIDENT_ROUTING[category].preferredThemes;
  const pool = districts.filter((district) => preferredThemes.includes(district.theme));

  const weightedPool = (pool.length > 0 ? pool : districts)
    .map((district) => ({
      district,
      weight: 0.7 + district.riskLevel
    }))
    .sort((a, b) => b.weight - a.weight);

  const index = Math.floor(rng() * Math.min(2, weightedPool.length));
  return weightedPool[index]?.district ?? districts[0];
}

function randomIncidentPosition(category: Incident["category"]): { position: Vec2; district: District } {
  const district = pickDistrictForCategory(category);
  const center = district.center;
  const spread = 2 + rng() * 2.6;
  const candidate = {
    x: center.x + (rng() * 2 - 1) * spread,
    y: center.y + (rng() * 2 - 1) * spread
  };
  return {
    position: navigation.ensureWalkable(candidate),
    district
  };
}

function spawnIncident(): Incident {
  const categories: Incident["category"][] = ["ci_failure", "security_vuln", "api_regression"];
  const severities: Incident["severity"][] = ["low", "medium", "high"];
  const category = categories[Math.floor(rng() * categories.length)];
  const severity = severities[Math.floor(rng() * severities.length)];
  const routed = randomIncidentPosition(category);
  const routing = INCIDENT_ROUTING[category];

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
    position: routed.position,
    retries: 0,
    timeline: []
  };

  incidents.push(incident);
  workflows.set(incident.id, { stage: 0, startedAtTick: tick });
  cinematicFocus = incident.id;

  addLog("decision", "scout-controller", "New incident discovered", {
    incidentId: incident.id,
    category,
    severity,
    position: incident.position,
    district: routed.district.name,
    zone: routing.zoneName,
    rationale: routing.rationale
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
      const requiredRole = stageByIndex[workflow.stage].role;
      const idleCandidates = findIdleAgentsByRole(requiredRole);
      if (idleCandidates.length === 0) {
        continue;
      }
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

    if (navigation.distance(actor.position, incident.position) < 0.75 && actor.path.length === 0) {
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
      budget,
      focus: cinematicFocus
    });
  }
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, tick, wsClients: wss.clients.size, worldSeed: WORLD_SEED });
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
    worldSeed: WORLD_SEED,
    stagePipeline: stageByIndex.map((stage) => stage.label)
  });
  setInterval(mainLoop, LOOP_INTERVAL_MS);
});
