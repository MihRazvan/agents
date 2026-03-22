export type AgentRole = "scout" | "planner" | "builder" | "verifier" | "publisher";

export type AgentPhase = "idle" | "discover" | "plan" | "execute" | "verify" | "submit" | "blocked";

export type AgentKind = "core" | "plugin";

export type JobStatus = "queued" | "negotiating" | "in_progress" | "verifying" | "completed" | "failed";

export type JobCategory =
  | "microsite_build"
  | "github_bugfix"
  | "protocol_research"
  | "move_contract"
  | "contract_audit";

export type JobPriority = "routine" | "priority" | "critical";

export interface Vec2 {
  x: number;
  y: number;
}

export interface AgentCapabilities {
  primarySkills: string[];
  taskCategories: JobCategory[];
  supportedTools: string[];
  maxConcurrentJobs: number;
}

export interface AgentRuntimeState {
  id: string;
  name: string;
  role: AgentRole;
  kind: AgentKind;
  phase: AgentPhase;
  position: Vec2;
  target: Vec2;
  path: Vec2[];
  trustScore: number;
  assignedJobId?: string;
  energy: number;
  speed: number;
  specialty: string;
  operatorWallet: string;
  erc8004Identity: string;
  homeDistrictId: string;
  capabilities: AgentCapabilities;
  statusLine?: string;
}

export interface Job {
  id: string;
  title: string;
  summary: string;
  category: JobCategory;
  priority: JobPriority;
  status: JobStatus;
  position: Vec2;
  source: "operator" | "github" | "api" | "agent";
  submitter: string;
  requestedSkills: string[];
  requiredTools: string[];
  requiredTrust: number;
  deliverable: string;
  retries: number;
  ownerAgentId?: string;
  assignedAgentIds: string[];
  timeline: string[];
  outputSummary?: string;
}

export interface District {
  id: string;
  name: string;
  center: Vec2;
  radius: number;
  theme: "core" | "industrial" | "research" | "residential";
  riskLevel: number;
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
  supportedTaskCategories: JobCategory[];
  primarySkills: string[];
  executionMode: "internal" | "plugin_adapter" | "remote";
}

export interface PluginAgentRecord {
  id: string;
  status: "pending" | "active" | "rejected";
  label: string;
  summary: string;
  preferredDistrictId: string;
  manifest: AgentManifest;
  operatorWallet: string;
  erc8004Identity: string;
  trustScore: number;
  reason?: string;
}

export interface ChatMessage {
  id: string;
  timestamp: string;
  actorId: string;
  actorName: string;
  recipientId?: string;
  recipientName?: string;
  jobId?: string;
  kind: "status" | "handoff" | "tool" | "trust" | "verification" | "delivery";
  tone: "info" | "decision" | "warning";
  message: string;
}

export type ReceiptAction =
  | "identity_registry_registration"
  | "operator_link_validation"
  | "metadata_update"
  | "reputation_registry_update"
  | "validation_registry_write";

export interface ReceiptRecord {
  id: string;
  action: ReceiptAction;
  txHash: string;
  timestamp: string;
  mode: "onchain" | "simulated";
  jobId?: string;
  explorerUrl?: string;
  context?: Record<string, unknown>;
}

export interface OnchainStatus {
  enabled: boolean;
  disabledReason?: string;
  chainId: string;
  network: string;
  rpcUrl: string;
  operatorWallet: string;
  feedbackWallet?: string;
  identityAgentId?: string;
  identityTxHash?: string;
  metadataTxHash?: string;
  reputationEnabled: boolean;
  validationRequested: boolean;
  validationEnabled: boolean;
  validationReason?: string;
  reputationTxHashes: string[];
  validationTxHashes: string[];
}

export interface WorldSnapshot {
  timestamp: string;
  tick: number;
  worldSeed: number;
  budget: {
    maxToolCalls: number;
    usedToolCalls: number;
    maxRetriesPerJob: number;
    maxRuntimeSeconds: number;
  };
  districts: District[];
  cinematicFocus?: string;
  receipts: ReceiptRecord[];
  onchainStatus: OnchainStatus;
  agents: AgentRuntimeState[];
  jobs: Job[];
  pluginAgents: PluginAgentRecord[];
  chats: ChatMessage[];
}

export type WsMessageType =
  | "world_snapshot"
  | "log_entry"
  | "receipt"
  | "job_submitted"
  | "job_completed"
  | "plugin_registered";

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
    name: "Arrival Port",
    position: { x: -96, y: -42 },
    purpose: "Intake lane for new jobs, agent arrivals, and external requests."
  },
  planner: {
    name: "Planning Hall",
    position: { x: -36, y: -22 },
    purpose: "Decomposes jobs, matches skills, and negotiates handoffs."
  },
  builder: {
    name: "Guild District",
    position: { x: 18, y: -12 },
    purpose: "Execution zone for specialists, plugin agents, and toolchains."
  },
  verifier: {
    name: "Audit Gate",
    position: { x: 72, y: -2 },
    purpose: "Runs validation, trust policy, and output review."
  },
  publisher: {
    name: "Receipt Tower",
    position: { x: 126, y: 6 },
    purpose: "Packages final artifacts and writes ERC-8004 receipts."
  }
};

export const DISTRICT_THEME_PURPOSE: Record<
  District["theme"],
  { label: string; purpose: string; preferredCategories: JobCategory[] }
> = {
  core: {
    label: "Registry Plaza",
    purpose: "Identity checks, trust lookups, and final publication.",
    preferredCategories: ["protocol_research", "contract_audit"]
  },
  industrial: {
    label: "Guild Works",
    purpose: "High-throughput execution for builds, fixes, and contract jobs.",
    preferredCategories: ["github_bugfix", "move_contract", "microsite_build"]
  },
  research: {
    label: "Atlas Quarter",
    purpose: "Planning, research synthesis, and capability matching.",
    preferredCategories: ["protocol_research", "github_bugfix", "contract_audit"]
  },
  residential: {
    label: "Launch Commons",
    purpose: "User-facing delivery, demos, and microsite deployment.",
    preferredCategories: ["microsite_build", "contract_audit"]
  }
};

export const JOB_ROUTING: Record<
  JobCategory,
  { preferredThemes: District["theme"][]; zoneName: string; rationale: string; label: string }
> = {
  microsite_build: {
    preferredThemes: ["residential", "industrial"],
    zoneName: "Launch Lane",
    rationale: "Microsite work routes through delivery-facing and build-heavy districts.",
    label: "Microsite Build"
  },
  github_bugfix: {
    preferredThemes: ["industrial", "research"],
    zoneName: "Patch Arcade",
    rationale: "Repo fixes route through planning and execution specialists.",
    label: "GitHub Bugfix"
  },
  protocol_research: {
    preferredThemes: ["research", "core"],
    zoneName: "Signal Library",
    rationale: "Research jobs rely on synthesis, source validation, and registry lookups.",
    label: "Protocol Research"
  },
  move_contract: {
    preferredThemes: ["industrial", "core"],
    zoneName: "Move Foundry",
    rationale: "Move contract work needs specialist tooling and higher trust gating.",
    label: "Move Contract"
  },
  contract_audit: {
    preferredThemes: ["core", "research"],
    zoneName: "Audit Ring",
    rationale: "Audit work routes through verification and evidence-focused zones.",
    label: "Contract Audit"
  }
};
