export type AgentRole = "scout" | "planner" | "builder" | "verifier" | "publisher";

export type AgentPhase = "idle" | "discover" | "plan" | "execute" | "verify" | "submit" | "blocked";

export type IncidentStatus = "open" | "in_progress" | "resolved" | "failed";

export interface Vec2 {
  x: number;
  y: number;
}

export interface AgentRuntimeState {
  id: string;
  name: string;
  role: AgentRole;
  phase: AgentPhase;
  position: Vec2;
  target: Vec2;
  path: Vec2[];
  trustScore: number;
  assignedIncidentId?: string;
  energy: number;
  speed: number;
}

export interface Incident {
  id: string;
  title: string;
  category: "ci_failure" | "security_vuln" | "api_regression";
  severity: "low" | "medium" | "high";
  status: IncidentStatus;
  position: Vec2;
  retries: number;
  ownerAgentId?: string;
  timeline: string[];
}

export interface District {
  id: string;
  name: string;
  center: Vec2;
  radius: number;
  theme: "core" | "industrial" | "research" | "residential";
  riskLevel: number;
}

export interface WorldSnapshot {
  timestamp: string;
  tick: number;
  worldSeed: number;
  budget: {
    maxToolCalls: number;
    usedToolCalls: number;
    maxRetriesPerIncident: number;
    maxRuntimeSeconds: number;
  };
  districts: District[];
  cinematicFocus?: string;
  receipts: string[];
  agents: AgentRuntimeState[];
  incidents: Incident[];
}

export type LogEntryType =
  | "decision"
  | "tool_call"
  | "retry"
  | "failure"
  | "output"
  | "onchain"
  | "safety"
  | "state";

export interface LogEntry {
  id: string;
  timestamp: string;
  tick: number;
  type: LogEntryType;
  actor: string;
  message: string;
  context?: Record<string, unknown>;
}

export interface AgentManifest {
  agentName: string;
  operatorWallet: string;
  erc8004Identity: string;
  supportedTools: string[];
  supportedTechStacks: string[];
  computeConstraints: {
    maxToolCalls: number;
    maxRuntimeSeconds: number;
    retryLimit: number;
  };
  supportedTaskCategories: string[];
}

export type WsMessageType =
  | "world_snapshot"
  | "log_entry"
  | "receipt"
  | "incident_spawned"
  | "incident_resolved";

export interface WsMessage<T = unknown> {
  type: WsMessageType;
  payload: T;
}

export const TRUST_THRESHOLD = 0.68;

export const AGENT_COLORS: Record<AgentRole, string> = {
  scout: "#54d2ff",
  planner: "#ffd166",
  builder: "#9cff57",
  verifier: "#ff7b7b",
  publisher: "#c792ff"
};

export interface RoleHub {
  name: string;
  position: Vec2;
  purpose: string;
}

export const ROLE_HUBS: Record<AgentRole, RoleHub> = {
  scout: {
    name: "Recon Dock",
    position: { x: -14, y: -10 },
    purpose: "Discover incidents and initiate response threads."
  },
  planner: {
    name: "Strategy Atrium",
    position: { x: -6, y: -10 },
    purpose: "Turn discovered incidents into executable plans."
  },
  builder: {
    name: "Execution Yard",
    position: { x: 1, y: -10 },
    purpose: "Apply fixes and run operational toolchains."
  },
  verifier: {
    name: "Validation Gate",
    position: { x: 8, y: -10 },
    purpose: "Check outputs, enforce quality and trust policy."
  },
  publisher: {
    name: "Receipt Terminal",
    position: { x: 12, y: -10 },
    purpose: "Finalize submissions and publish ERC-8004 receipts."
  }
};

export const DISTRICT_THEME_PURPOSE: Record<
  District["theme"],
  { label: string; purpose: string; preferredCategories: Incident["category"][] }
> = {
  core: {
    label: "Core Nexus",
    purpose: "Command, routing and publication control.",
    preferredCategories: ["api_regression", "ci_failure"]
  },
  industrial: {
    label: "Forge Quarter",
    purpose: "Build pipelines, package remediation and execution tooling.",
    preferredCategories: ["security_vuln", "ci_failure"]
  },
  research: {
    label: "Helix Labs",
    purpose: "Planning intelligence, simulations and dependency analysis.",
    preferredCategories: ["ci_failure", "api_regression"]
  },
  residential: {
    label: "Lumen Habitat",
    purpose: "Public edge services and user-impact monitoring.",
    preferredCategories: ["api_regression", "security_vuln"]
  }
};

export const INCIDENT_ROUTING: Record<
  Incident["category"],
  { preferredThemes: District["theme"][]; zoneName: string; rationale: string }
> = {
  ci_failure: {
    preferredThemes: ["research", "industrial"],
    zoneName: "CI Recovery Corridor",
    rationale: "CI incidents route near planning and build infrastructure."
  },
  security_vuln: {
    preferredThemes: ["industrial", "residential"],
    zoneName: "Security Hardening Ring",
    rationale: "Security issues route near patch execution and public-edge risk."
  },
  api_regression: {
    preferredThemes: ["core", "residential"],
    zoneName: "Service Reliability Belt",
    rationale: "API regressions route near command and user-facing systems."
  }
};
