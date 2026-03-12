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
  trustScore: number;
  assignedIncidentId?: string;
  energy: number;
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

export interface WorldSnapshot {
  timestamp: string;
  tick: number;
  budget: {
    maxToolCalls: number;
    usedToolCalls: number;
    maxRetriesPerIncident: number;
    maxRuntimeSeconds: number;
  };
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
