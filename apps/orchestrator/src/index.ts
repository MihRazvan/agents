import cors from "cors";
import express from "express";
import { randomBytes, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { WebSocketServer } from "ws";
import {
  AGENT_COLORS,
  DISTRICT_THEME_PURPOSE,
  JOB_ROUTING,
  ROLE_HUBS,
  TRUST_THRESHOLD,
  type AgentCapabilities,
  type AgentManifest,
  type AgentPhase,
  type AgentRole,
  type AgentRuntimeState,
  type ChatMessage,
  type District,
  type Job,
  type JobCategory,
  type LogEntry,
  type PluginAgentRecord,
  type Vec2,
  type WorldSnapshot,
  type WsMessage
} from "@trust-city/shared";
import { createNavigation } from "./navigation.js";
import { OnchainManager } from "./onchain.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../../..");
loadEnv({ path: path.join(rootDir, ".env") });

const HTTP_PORT = Number(process.env.ORCHESTRATOR_PORT ?? "8787");
const LOOP_INTERVAL_MS = 400;
const WORLD_SEED = Number(process.env.WORLD_SEED ?? "271828");

const operatorWallet = process.env.OPERATOR_WALLET ?? "0xD3aDbeefD3aDbeefD3aDbeefD3aDbeefD3aDbeef";
const erc8004Identity = process.env.AGENT_ERC8004_ID ?? "agent:erc8004:trust-city-exchange";

const GRID_MIN = -164;
const GRID_MAX = 164;
const GRID_STEP = 1;
const ROAD_MAJOR_SPACING = 24;
const ROAD_MINOR_SPACING = 12;
const ROAD_MAJOR_HALF_WIDTH = 2;
const ROAD_MINOR_HALF_WIDTH = 1;

const manifest: AgentManifest = {
  agentName: "Trust City Exchange",
  operatorWallet,
  erc8004Identity,
  supportedTools: [
    "github_api",
    "git",
    "security_scanner",
    "test_runner",
    "deploy_preview",
    "erc8004_registry_writer",
    "plugin_registry",
    "move_cli",
    "research_fetcher"
  ],
  supportedTechStacks: ["TypeScript", "React", "Three.js", "Node.js", "EVM", "Move"],
  computeConstraints: {
    maxToolCalls: 320,
    maxRuntimeSeconds: 1200,
    retryLimit: 3
  },
  supportedTaskCategories: ["microsite_build", "github_bugfix", "protocol_research", "move_contract", "contract_audit"],
  primarySkills: ["job-routing", "trust-gating", "agent-orchestration", "receipt-publishing"],
  executionMode: "internal"
};

const budget = {
  maxToolCalls: 320,
  usedToolCalls: 0,
  maxRetriesPerJob: 3,
  maxRuntimeSeconds: 1200
};

interface JobWorkflow {
  stage: number;
  activeAgentId?: string;
  startedAtTick: number;
}

interface JobTemplate {
  title: string;
  summary: string;
  category: JobCategory;
  priority: Job["priority"];
  source: Job["source"];
  submitter: string;
  requestedSkills: string[];
  requiredTools: string[];
  requiredTrust: number;
  deliverable: string;
}

interface PluginRegistrationRequest {
  label?: string;
  summary?: string;
  manifest: AgentManifest;
  preferredDistrictId?: string;
  trustScore?: number;
  specialty?: string;
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

const jobs: Job[] = [];
const jobQueue: JobTemplate[] = buildJobTemplates();
const pluginAgents: PluginAgentRecord[] = [];
const workflows = new Map<string, JobWorkflow>();
const logs: LogEntry[] = [];
const chats: ChatMessage[] = [];
const receipts: string[] = [];

let tick = 0;
let loopStartedAt = Date.now();
let cinematicFocus: string | undefined;
let queuedJobIndex = 0;

function hubPoint(role: AgentRole, offset?: Vec2): Vec2 {
  return {
    x: ROLE_HUBS[role].position.x + (offset?.x ?? 0),
    y: ROLE_HUBS[role].position.y + (offset?.y ?? 0)
  };
}

function allCategories(): JobCategory[] {
  return ["microsite_build", "github_bugfix", "protocol_research", "move_contract", "contract_audit"];
}

function capabilityProfile(
  primarySkills: string[],
  taskCategories: JobCategory[],
  supportedTools: string[],
  maxConcurrentJobs = 1
): AgentCapabilities {
  return {
    primarySkills,
    taskCategories,
    supportedTools,
    maxConcurrentJobs
  };
}

function createCoreAgent(config: {
  id: string;
  name: string;
  role: AgentRole;
  trustScore: number;
  speed: number;
  specialty: string;
  homeDistrictId: string;
  capabilities: AgentCapabilities;
  offset?: Vec2;
}): AgentRuntimeState {
  const home = hubPoint(config.role, config.offset);
  return {
    id: config.id,
    name: config.name,
    role: config.role,
    kind: "core",
    phase: "idle",
    trustScore: config.trustScore,
    position: home,
    target: home,
    path: [],
    energy: 1,
    speed: config.speed,
    specialty: config.specialty,
    operatorWallet,
    erc8004Identity: `agent:erc8004:${config.id}`,
    homeDistrictId: config.homeDistrictId,
    capabilities: config.capabilities,
    statusLine: `Ready at ${ROLE_HUBS[config.role].name}`
  };
}

const agents: AgentRuntimeState[] = [
  createCoreAgent({
    id: "agent-scout-1",
    name: "Scout Nova",
    role: "scout",
    trustScore: 0.91,
    speed: 1.2,
    specialty: "Job intake and source classification",
    homeDistrictId: "district-registry",
    capabilities: capabilityProfile(["intake", "classification", "source-triage"], allCategories(), ["job_feed", "registry_reader"])
  }),
  createCoreAgent({
    id: "agent-planner-1",
    name: "Planner Atlas",
    role: "planner",
    trustScore: 0.89,
    speed: 1.04,
    specialty: "Task decomposition and routing strategy",
    homeDistrictId: "district-atlas",
    capabilities: capabilityProfile(
      ["decomposition", "capability-matching", "dependency-mapping"],
      allCategories(),
      ["planner_graph", "registry_reader", "policy_engine"]
    )
  }),
  createCoreAgent({
    id: "agent-builder-1",
    name: "Builder Forge",
    role: "builder",
    trustScore: 0.76,
    speed: 0.96,
    specialty: "React, repo patches, and shipping previews",
    homeDistrictId: "district-guild",
    capabilities: capabilityProfile(
      ["react", "typescript", "repo-fixes", "deployments"],
      ["microsite_build", "github_bugfix", "contract_audit"],
      ["github_api", "git", "vite", "test_runner", "deploy_preview"]
    )
  }),
  createCoreAgent({
    id: "agent-builder-2",
    name: "Builder Flux",
    role: "builder",
    trustScore: 0.63,
    speed: 0.9,
    specialty: "General execution, lower trust tier",
    homeDistrictId: "district-guild",
    capabilities: capabilityProfile(
      ["typescript", "automation"],
      ["github_bugfix", "microsite_build"],
      ["github_api", "git", "test_runner"],
      1
    ),
    offset: { x: 10, y: -2 }
  }),
  createCoreAgent({
    id: "agent-verifier-1",
    name: "Verifier Echo",
    role: "verifier",
    trustScore: 0.92,
    speed: 0.98,
    specialty: "Quality gates, trust checks, and evidence review",
    homeDistrictId: "district-registry",
    capabilities: capabilityProfile(
      ["testing", "audit", "verification"],
      allCategories(),
      ["test_runner", "security_scanner", "registry_reader", "evidence_packager"]
    )
  }),
  createCoreAgent({
    id: "agent-publisher-1",
    name: "Publisher Relay",
    role: "publisher",
    trustScore: 0.94,
    speed: 1.08,
    specialty: "Artifact packaging and ERC-8004 receipt publishing",
    homeDistrictId: "district-commons",
    capabilities: capabilityProfile(
      ["publishing", "submission", "receipt-writing"],
      allCategories(),
      ["deploy_preview", "erc8004_registry_writer", "artifact_packager"]
    )
  })
];

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
  if (logs.length > 1800) {
    logs.splice(0, logs.length - 1800);
  }
}

function trimChats(): void {
  if (chats.length > 80) {
    chats.splice(0, chats.length - 80);
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

function addChat(actorId: string, actorName: string, message: string, tone: ChatMessage["tone"] = "info"): void {
  const chat: ChatMessage = {
    id: randomUUID(),
    timestamp: nowIso(),
    actorId,
    actorName,
    tone,
    message
  };
  chats.push(chat);
  trimChats();
}

function recordReceipt(action: string, txHash: string, jobId?: string, extra?: Record<string, unknown>): string {
  receipts.push(txHash);
  if (receipts.length > 100) {
    receipts.splice(0, receipts.length - 100);
  }
  addLog("onchain", "erc8004-writer", `Onchain ${action} receipt committed`, {
    txHash,
    jobId,
    ...extra
  });
  broadcast({ type: "receipt", payload: { txHash, action, jobId, timestamp: nowIso(), ...extra } });
  return txHash;
}

function emitLocalReceipt(action: string, jobId?: string, extra?: Record<string, unknown>): string {
  return recordReceipt(action, makeTxHash(), jobId, extra);
}

const onchain = new OnchainManager(manifest, {
  onReceipt: (action, txHash, context) => {
    recordReceipt(action, txHash, typeof context?.jobId === "string" ? context.jobId : undefined, context);
  },
  onInfo: (message, context) => {
    addLog("state", "erc8004-writer", message, context);
  },
  onError: (message, context) => {
    addLog("failure", "erc8004-writer", message, context);
  }
});

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
    jobs,
    pluginAgents,
    chats
  };
}

function buildDistricts(): District[] {
  const districtDefs = [
    {
      id: "district-registry",
      name: DISTRICT_THEME_PURPOSE.core.label,
      theme: "core" as const,
      center: { x: 84, y: 28 }
    },
    {
      id: "district-guild",
      name: DISTRICT_THEME_PURPOSE.industrial.label,
      theme: "industrial" as const,
      center: { x: 28, y: -34 }
    },
    {
      id: "district-atlas",
      name: DISTRICT_THEME_PURPOSE.research.label,
      theme: "research" as const,
      center: { x: -44, y: 18 }
    },
    {
      id: "district-commons",
      name: DISTRICT_THEME_PURPOSE.residential.label,
      theme: "residential" as const,
      center: { x: 118, y: 40 }
    }
  ];

  return districtDefs.map((item, index) => {
    const jitterScale = 3 + index;
    return {
      id: item.id,
      name: item.name,
      center: {
        x: item.center.x + (rng() * 2 - 1) * jitterScale,
        y: item.center.y + (rng() * 2 - 1) * jitterScale
      },
      radius: 14 + rng() * 6,
      theme: item.theme,
      riskLevel: 0.45 + rng() * 0.45
    };
  });
}

function buildJobTemplates(): JobTemplate[] {
  return [
    {
      title: "Launch page for Move Sentinel",
      summary: "Create a one-page microsite that explains why the Move plugin agent can be trusted and what jobs it accepts.",
      category: "microsite_build",
      priority: "priority",
      source: "operator",
      submitter: "Hackathon Operator",
      requestedSkills: ["React", "copywriting", "deployment"],
      requiredTools: ["github_api", "vite", "deploy_preview"],
      requiredTrust: 0.72,
      deliverable: "Preview deployment with summary card"
    },
    {
      title: "Patch wallet connect regression",
      summary: "Investigate a failing GitHub issue in the onboarding flow and produce a tested remediation patch.",
      category: "github_bugfix",
      priority: "priority",
      source: "github",
      submitter: "GitHub Queue",
      requestedSkills: ["TypeScript", "debugging", "tests"],
      requiredTools: ["github_api", "git", "test_runner"],
      requiredTrust: 0.7,
      deliverable: "Patch artifact with test evidence"
    },
    {
      title: "Research ERC-8004 collaboration patterns",
      summary: "Produce a sourced research brief on trust-gated agent collaboration patterns and validation workflows.",
      category: "protocol_research",
      priority: "routine",
      source: "api",
      submitter: "Research Feed",
      requestedSkills: ["analysis", "sourcing", "writing"],
      requiredTools: ["research_fetcher"],
      requiredTrust: 0.68,
      deliverable: "Research brief with source digest"
    },
    {
      title: "Review Move vault module",
      summary: "A partner agent submitted a Move vault module. Validate it, identify issues, and package a delivery receipt.",
      category: "move_contract",
      priority: "critical",
      source: "agent",
      submitter: "Partner Agent",
      requestedSkills: ["Move", "auditing", "tests"],
      requiredTools: ["move_cli", "test_runner", "github_api"],
      requiredTrust: 0.82,
      deliverable: "Validated Move report with attestation"
    },
    {
      title: "Audit plugin payout contract",
      summary: "Review a lightweight payout contract used for agent task settlements and produce a verification verdict.",
      category: "contract_audit",
      priority: "priority",
      source: "operator",
      submitter: "Protocol Team",
      requestedSkills: ["solidity", "security", "evidence"],
      requiredTools: ["security_scanner", "test_runner"],
      requiredTrust: 0.8,
      deliverable: "Audit summary and verification receipt"
    }
  ];
}

function setAgentDestination(agent: AgentRuntimeState, destination: Vec2): void {
  const safeDestination = navigation.ensureWalkable(destination);
  const path = navigation.planPath(agent.position, safeDestination);
  agent.path = path;
  agent.target = path[0] ?? safeDestination;
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
  agent.assignedJobId = undefined;
  agent.statusLine = `Ready at ${ROLE_HUBS[agent.role].name}`;
  setAgentDestination(agent, hubPoint(agent.role));
}

function scoreAgentForJob(agent: AgentRuntimeState, job: Job): number {
  const skillMatches = job.requestedSkills.filter((skill) =>
    agent.capabilities.primarySkills.some((entry) => entry.toLowerCase().includes(skill.toLowerCase()))
  ).length;
  const toolMatches = job.requiredTools.filter((tool) => agent.capabilities.supportedTools.includes(tool)).length;
  const categoryMatch = agent.capabilities.taskCategories.includes(job.category) ? 2 : 0;
  const pluginBonus = agent.kind === "plugin" ? 0.6 : 0;
  return agent.trustScore * 4 + skillMatches * 1.1 + toolMatches * 0.7 + categoryMatch + pluginBonus;
}

function supportsJobStage(agent: AgentRuntimeState, role: AgentRole, job: Job): boolean {
  if (agent.role !== role) {
    return false;
  }

  const threshold = Math.max(TRUST_THRESHOLD, role === "builder" || role === "verifier" || role === "publisher" ? job.requiredTrust : TRUST_THRESHOLD);
  if (agent.trustScore < threshold) {
    return false;
  }

  if (!agent.capabilities.taskCategories.includes(job.category)) {
    return false;
  }

  if (role === "builder") {
    return job.requiredTools.every((tool) => agent.capabilities.supportedTools.includes(tool));
  }

  return true;
}

function findEligibleAgents(role: AgentRole, job: Job): AgentRuntimeState[] {
  return agents
    .filter((agent) => agent.phase === "idle" && !agent.assignedJobId)
    .filter((agent) => supportsJobStage(agent, role, job))
    .sort((a, b) => scoreAgentForJob(b, job) - scoreAgentForJob(a, job));
}

function allocateStageAgent(job: Job, workflow: JobWorkflow): AgentRuntimeState | null {
  const step = stageByIndex[workflow.stage];
  const candidates = findEligibleAgents(step.role, job);
  const candidate = candidates[0] ?? null;

  if (!candidate) {
    cinematicFocus = job.id;
    addLog("safety", "policy-engine", "Trust gate blocked job handoff", {
      jobId: job.id,
      requiredRole: step.role,
      category: job.category,
      threshold: Math.max(TRUST_THRESHOLD, job.requiredTrust)
    });
    addChat("policy-engine", "Policy Engine", `${JOB_ROUTING[job.category].label} paused. No eligible ${step.role} cleared trust and capability checks.`, "warning");
    return null;
  }

  candidate.phase = step.key;
  candidate.assignedJobId = job.id;
  candidate.statusLine = `${step.label} ${JOB_ROUTING[job.category].label}`;
  setAgentDestination(candidate, job.position);

  workflow.activeAgentId = candidate.id;
  job.ownerAgentId = candidate.id;
  job.assignedAgentIds = [...new Set([...job.assignedAgentIds, candidate.id])];
  job.status = workflow.stage < 2 ? "negotiating" : workflow.stage === 3 ? "verifying" : "in_progress";
  cinematicFocus = job.id;

  addLog("decision", candidate.id, `Assigned ${step.label} stage to ${candidate.name}`, {
    jobId: job.id,
    category: job.category,
    stage: workflow.stage,
    trustScore: candidate.trustScore,
    kind: candidate.kind,
    color: AGENT_COLORS[candidate.role]
  });
  addChat(candidate.id, candidate.name, `${step.label === "execute" ? "Taking" : "Claiming"} ${JOB_ROUTING[job.category].label} for ${step.label}.`, "decision");

  return candidate;
}

function stageFailureChance(stage: number, job: Job, actor: AgentRuntimeState): number {
  const base = job.priority === "critical" ? 0.21 : job.priority === "priority" ? 0.14 : 0.09;
  const categoryPenalty = job.category === "move_contract" ? 0.06 : job.category === "contract_audit" ? 0.04 : 0;
  const trustRelief = Math.max(0, actor.trustScore - 0.7) * 0.12;
  return Math.min(0.42, Math.max(0.04, base + categoryPenalty + stage * 0.03 - trustRelief));
}

function runToolCall(step: { label: string; key: AgentPhase }, actor: AgentRuntimeState, job: Job): boolean {
  budget.usedToolCalls += 1;

  const preferredTool =
    step.key === "execute"
      ? job.requiredTools[0] ?? actor.capabilities.supportedTools[0]
      : actor.capabilities.supportedTools[Math.min(1, actor.capabilities.supportedTools.length - 1)] ?? `${step.key}_toolchain`;

  addLog("tool_call", actor.id, `Toolchain execution for ${step.label}`, {
    jobId: job.id,
    tool: preferredTool,
    usedToolCalls: budget.usedToolCalls,
    maxToolCalls: budget.maxToolCalls
  });
  addChat(actor.id, actor.name, `${step.label === "execute" ? "Running" : "Using"} ${preferredTool} on ${JOB_ROUTING[job.category].label}.`);

  const failed = Math.random() < stageFailureChance(workflows.get(job.id)?.stage ?? 0, job, actor);
  if (!failed) {
    return true;
  }

  job.retries += 1;
  cinematicFocus = job.id;

  addLog("retry", actor.id, "Job step failed, retry scheduled", {
    jobId: job.id,
    retries: job.retries,
    retryLimit: budget.maxRetriesPerJob
  });
  addChat(actor.id, actor.name, `Tool output failed verification. Re-queuing ${JOB_ROUTING[job.category].label}.`, "warning");

  if (job.retries > budget.maxRetriesPerJob) {
    job.status = "failed";
    job.outputSummary = "Retry budget exhausted before delivery";
    addLog("failure", actor.id, "Job marked failed after retry budget exhausted", {
      jobId: job.id,
      retries: job.retries
    });
  }

  return false;
}

function finalOutputSummary(job: Job, actor: AgentRuntimeState): string {
  if (job.category === "microsite_build") {
    return `Preview ready and packaged by ${actor.name}`;
  }
  if (job.category === "github_bugfix") {
    return `Patch and test evidence prepared by ${actor.name}`;
  }
  if (job.category === "protocol_research") {
    return `Research brief and source digest assembled by ${actor.name}`;
  }
  if (job.category === "move_contract") {
    return `Move validation bundle prepared by ${actor.name}`;
  }
  return `Audit verdict and receipt package assembled by ${actor.name}`;
}

function completeStage(job: Job, workflow: JobWorkflow): void {
  const step = stageByIndex[workflow.stage];
  const actor = agents.find((agent) => agent.id === workflow.activeAgentId);
  if (!actor) {
    return;
  }

  const success = runToolCall(step, actor, job);
  if (!success) {
    if (job.status === "failed") {
      setAgentIdle(actor.id);
      workflow.activeAgentId = undefined;
      addChat("system", "System", `${job.title} failed after exhausting retries.`, "warning");
      return;
    }

    setAgentIdle(actor.id);
    workflow.activeAgentId = undefined;
    if (step.key === "verify" && workflow.stage > 1) {
      workflow.stage = 2;
      addChat("agent-verifier-1", "Verifier Echo", "Sending work back to execution for correction.", "warning");
    }
    return;
  }

  job.timeline.push(`${step.label}@${nowIso()}`);
  addLog("output", actor.id, `Stage completed: ${step.label}`, {
    jobId: job.id,
    stage: workflow.stage
  });

  if (step.key === "plan") {
    addChat(actor.id, actor.name, `Plan ready. Needs ${job.requestedSkills.join(", ")} with trust >= ${job.requiredTrust.toFixed(2)}.`, "decision");
  }

  if (step.key === "verify") {
    job.status = "verifying";
    if (onchain.validationEnabled) {
      void onchain.requestValidation(job);
    } else if (!onchain.enabled) {
      emitLocalReceipt("validation_registry_write", job.id, { validator: actor.id });
    }
    addChat(actor.id, actor.name, `Validation passed for ${JOB_ROUTING[job.category].label}.`, "decision");
  }

  if (step.key === "submit") {
    job.status = "completed";
    job.outputSummary = finalOutputSummary(job, actor);
    if (onchain.reputationEnabled) {
      void onchain.recordJobCompletion(job, actor);
    } else if (!onchain.enabled) {
      emitLocalReceipt("reputation_registry_update", job.id, { publisher: actor.id });
    }
    addLog("output", actor.id, "Job completed and submitted", {
      jobId: job.id,
      finalTimeline: job.timeline,
      outputSummary: job.outputSummary
    });
    addChat(actor.id, actor.name, `Delivery sealed. ${job.outputSummary}.`, "decision");
    cinematicFocus = job.id;
    broadcast({ type: "job_completed", payload: job });
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

function pickDistrictForCategory(category: JobCategory): District {
  const preferredThemes = JOB_ROUTING[category].preferredThemes;
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

function randomJobPosition(category: JobCategory): { position: Vec2; district: District } {
  const district = pickDistrictForCategory(category);
  const center = district.center;
  const spread = 3 + rng() * 3.2;
  const candidate = {
    x: center.x + (rng() * 2 - 1) * spread,
    y: center.y + (rng() * 2 - 1) * spread
  };

  return {
    position: navigation.ensureWalkable(candidate),
    district
  };
}

function spawnJob(template?: JobTemplate): Job {
  const nextTemplate = template ?? jobQueue[queuedJobIndex % jobQueue.length];
  queuedJobIndex += template ? 0 : 1;

  const routed = randomJobPosition(nextTemplate.category);
  const routing = JOB_ROUTING[nextTemplate.category];

  const job: Job = {
    id: `job-${randomUUID().slice(0, 8)}`,
    title: nextTemplate.title,
    summary: nextTemplate.summary,
    category: nextTemplate.category,
    priority: nextTemplate.priority,
    status: "queued",
    position: routed.position,
    source: nextTemplate.source,
    submitter: nextTemplate.submitter,
    requestedSkills: nextTemplate.requestedSkills,
    requiredTools: nextTemplate.requiredTools,
    requiredTrust: nextTemplate.requiredTrust,
    deliverable: nextTemplate.deliverable,
    retries: 0,
    assignedAgentIds: [],
    timeline: []
  };

  jobs.push(job);
  workflows.set(job.id, { stage: 0, startedAtTick: tick });
  cinematicFocus = job.id;

  addLog("decision", "job-board", "New job entered the city", {
    jobId: job.id,
    title: job.title,
    category: job.category,
    source: job.source,
    submitter: job.submitter,
    district: routed.district.name,
    zone: routing.zoneName,
    rationale: routing.rationale
  });
  addChat("job-board", "Job Board", `${job.title} arrived from ${job.submitter}. Routing to ${routing.zoneName}.`, "decision");

  broadcast({ type: "job_submitted", payload: job });
  return job;
}

function processJobs(): void {
  for (const job of jobs) {
    const workflow = workflows.get(job.id);
    if (!workflow) {
      continue;
    }

    if (job.status === "completed" || job.status === "failed") {
      continue;
    }

    if (budget.usedToolCalls >= budget.maxToolCalls) {
      job.status = "failed";
      job.outputSummary = "Aborted because the compute budget was exhausted";
      addLog("safety", "budget-guard", "Job aborted due to tool-call budget exhaustion", {
        jobId: job.id,
        usedToolCalls: budget.usedToolCalls
      });
      continue;
    }

    if (workflow.stage >= stageByIndex.length) {
      continue;
    }

    if (!workflow.activeAgentId) {
      const assigned = allocateStageAgent(job, workflow);
      if (!assigned) {
        job.retries += 1;
        if (job.retries > budget.maxRetriesPerJob) {
          job.status = "failed";
          job.outputSummary = "No eligible agent cleared trust and capability checks";
          addLog("failure", "policy-engine", "Job failed after trust-gate retries", {
            jobId: job.id,
            retries: job.retries
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

    if (navigation.distance(actor.position, job.position) < 0.75 && actor.path.length === 0) {
      completeStage(job, workflow);
    }
  }
}

function runtimeGuardrails(): void {
  const runtimeSeconds = (Date.now() - loopStartedAt) / 1000;
  if (runtimeSeconds > budget.maxRuntimeSeconds) {
    addLog("safety", "runtime-guard", "Runtime budget reached; holding job intake", {
      runtimeSeconds,
      maxRuntimeSeconds: budget.maxRuntimeSeconds
    });
  }
}

function inferPluginSpecialty(manifestInput: AgentManifest): string {
  const firstSkill = manifestInput.primarySkills[0];
  return firstSkill ? `${firstSkill} specialist` : "Specialist agent";
}

function registerPluginAgent(request: PluginRegistrationRequest): PluginAgentRecord {
  const trustScore = request.trustScore ?? 0.78;
  const record: PluginAgentRecord = {
    id: `plugin-${randomUUID().slice(0, 8)}`,
    status: trustScore >= TRUST_THRESHOLD && request.manifest.supportedTaskCategories.length > 0 ? "active" : "rejected",
    label: request.label ?? request.manifest.agentName,
    summary: request.summary ?? `Plugin agent for ${request.manifest.supportedTaskCategories.join(", ")}`,
    preferredDistrictId: request.preferredDistrictId ?? "district-guild",
    manifest: request.manifest,
    operatorWallet: request.manifest.operatorWallet,
    erc8004Identity: request.manifest.erc8004Identity,
    trustScore,
    reason: trustScore >= TRUST_THRESHOLD ? undefined : "Trust score below minimum threshold"
  };

  pluginAgents.push(record);

  if (record.status === "active") {
    const activeCount = agents.filter((agent) => agent.kind === "plugin").length;
    agents.push({
      id: record.id,
      name: record.label,
      role: "builder",
      kind: "plugin",
      phase: "idle",
      trustScore: record.trustScore,
      position: hubPoint("builder", { x: 14 + activeCount * 8, y: 8 - activeCount * 3 }),
      target: hubPoint("builder", { x: 14 + activeCount * 8, y: 8 - activeCount * 3 }),
      path: [],
      energy: 1,
      speed: 0.96 + activeCount * 0.03,
      specialty: request.specialty ?? inferPluginSpecialty(request.manifest),
      operatorWallet: record.operatorWallet,
      erc8004Identity: record.erc8004Identity,
      homeDistrictId: record.preferredDistrictId,
      capabilities: capabilityProfile(
        request.manifest.primarySkills,
        request.manifest.supportedTaskCategories,
        request.manifest.supportedTools,
        1
      ),
      statusLine: "Awaiting marketplace jobs"
    });

    if (!onchain.enabled) {
      emitLocalReceipt("identity_registry_registration", undefined, { pluginAgentId: record.id, operatorWallet: record.operatorWallet });
    }
    addLog("decision", "registry-plaza", "Plugin agent admitted to the city", {
      pluginAgentId: record.id,
      name: record.label,
      trustScore: record.trustScore,
      categories: request.manifest.supportedTaskCategories
    });
    addChat("registry-plaza", "Registry Plaza", `${record.label} cleared trust checks and joined the Guild District.`, "decision");
  } else {
    addLog("safety", "registry-plaza", "Plugin agent rejected during onboarding", {
      pluginAgentId: record.id,
      name: record.label,
      trustScore: record.trustScore,
      reason: record.reason
    });
    addChat("registry-plaza", "Registry Plaza", `${record.label} rejected: ${record.reason}.`, "warning");
  }

  broadcast({ type: "plugin_registered", payload: record });
  return record;
}

function seedPlugins(): void {
  registerPluginAgent({
    label: "Move Sentinel",
    summary: "Third-party plugin agent for Move smart contract tasks.",
    trustScore: 0.93,
    specialty: "Move smart contracts and protocol validation",
    manifest: {
      agentName: "Move Sentinel",
      operatorWallet: "0x9aa4a0ef5A7b3BfA7f47C6e47fBbe9D5A0b3fEc9",
      erc8004Identity: "agent:erc8004:move-sentinel",
      supportedTools: ["move_cli", "test_runner", "github_api", "security_scanner"],
      supportedTechStacks: ["Move", "Aptos", "TypeScript"],
      computeConstraints: { maxToolCalls: 90, maxRuntimeSeconds: 600, retryLimit: 2 },
      supportedTaskCategories: ["move_contract", "contract_audit"],
      primarySkills: ["Move", "auditing", "formal review"],
      executionMode: "plugin_adapter"
    }
  });

  registerPluginAgent({
    label: "QuickPatch Beta",
    summary: "Low-trust plugin agent attempting to join the execution district.",
    trustScore: 0.52,
    specialty: "Low-cost patch automation",
    manifest: {
      agentName: "QuickPatch Beta",
      operatorWallet: "0x1ff3f1E8b0B8000000000000000000000BadBeta",
      erc8004Identity: "agent:erc8004:quickpatch-beta",
      supportedTools: ["github_api", "git"],
      supportedTechStacks: ["TypeScript"],
      computeConstraints: { maxToolCalls: 40, maxRuntimeSeconds: 300, retryLimit: 1 },
      supportedTaskCategories: ["github_bugfix"],
      primarySkills: ["repo-fixes"],
      executionMode: "plugin_adapter"
    }
  });
}

function mainLoop(): void {
  tick += 1;

  if (tick === 1) {
    if (onchain.enabled) {
      void onchain.bootstrap();
      addLog("state", "erc8004-writer", "Real Sepolia writes enabled", {
        chainId: process.env.CHAIN_ID ?? "11155111",
        rpcUrl: process.env.SEPOLIA_RPC_URL ?? "sdk-default"
      });
    } else {
      emitLocalReceipt("identity_registry_registration", undefined, { operatorWallet });
      emitLocalReceipt("operator_link_validation", undefined, { operatorWallet, erc8004Identity });
    }
    seedPlugins();
    spawnJob();
    spawnJob(jobQueue.find((job) => job.category === "move_contract"));
  }

  if (tick % 110 === 0 && jobs.filter((job) => job.status === "queued" || job.status === "negotiating" || job.status === "in_progress" || job.status === "verifying").length < 3) {
    spawnJob();
  }

  runtimeGuardrails();
  processJobs();
  tickMovement();

  const snapshot = getSnapshot();
  broadcast({ type: "world_snapshot", payload: snapshot });

  if (tick % 12 === 0) {
    addLog("state", "system", "Periodic state checkpoint", {
      openJobs: jobs.filter((job) => job.status !== "completed" && job.status !== "failed").length,
      completedJobs: jobs.filter((job) => job.status === "completed").length,
      failedJobs: jobs.filter((job) => job.status === "failed").length,
      pluginAgents: pluginAgents.length,
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

app.get("/plugins", (_req, res) => {
  res.json(pluginAgents);
});

app.post("/plugins", (req, res) => {
  const body = req.body as Partial<PluginRegistrationRequest>;
  if (!body?.manifest?.agentName || !body.manifest.operatorWallet || !body.manifest.erc8004Identity) {
    res.status(400).json({ ok: false, error: "manifest.agentName, operatorWallet, and erc8004Identity are required" });
    return;
  }

  const record = registerPluginAgent({
    manifest: body.manifest,
    label: body.label,
    summary: body.summary,
    preferredDistrictId: body.preferredDistrictId,
    trustScore: body.trustScore,
    specialty: body.specialty
  });

  res.status(201).json({ ok: true, plugin: record });
});

app.get("/jobs", (_req, res) => {
  res.json(jobs);
});

wss.on("connection", (socket) => {
  socket.send(JSON.stringify({ type: "world_snapshot", payload: getSnapshot() }));
});

server.listen(HTTP_PORT, async () => {
  await persistArtifacts();
  addLog("decision", "system", "Trust City Exchange orchestrator online", {
    port: HTTP_PORT,
    trustThreshold: TRUST_THRESHOLD,
    worldSeed: WORLD_SEED,
    stagePipeline: stageByIndex.map((stage) => stage.label)
  });
  addChat("system", "System", "Trust City Exchange online. Waiting for jobs and plugin agents.", "decision");
  setInterval(mainLoop, LOOP_INTERVAL_MS);
});
