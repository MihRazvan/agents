import { useEffect, useMemo, useRef, useState } from "react";
import {
  JOB_ROUTING,
  ROLE_HUBS,
  type AgentManifest,
  type ChatMessage,
  type Job,
  type LogEntry,
  type OnchainStatus,
  type PluginAgentRecord,
  type ReceiptRecord,
  type WorldSnapshot,
  type WsMessage
} from "@trust-city/shared";
import SubmitJobCard from "./components/SubmitJobCard";
import PlugInAgentCard from "./components/PlugInAgentCard";
import TrustCityMark from "./components/TrustCityMark";
import WorldScene from "./components/WorldScene";

const httpBase = import.meta.env.VITE_ORCHESTRATOR_HTTP ?? "http://localhost:8787";
const wsBase = import.meta.env.VITE_ORCHESTRATOR_WS ?? httpBase.replace("http://", "ws://").replace("https://", "wss://") + "/ws";

function formatPhase(phase: string): string {
  return phase.replace(/_/g, " ");
}

function shortHash(hash: string): string {
  if (hash.length < 12) {
    return hash;
  }
  return `${hash.slice(0, 8)}...${hash.slice(-6)}`;
}

function formatStatus(status: string): string {
  return status.replace(/_/g, " ");
}

function formatRisk(risk: string): string {
  return risk.charAt(0).toUpperCase() + risk.slice(1);
}

const OPEN_JOB_STATUS_ORDER = {
  queued: 0,
  negotiating: 1,
  in_progress: 2,
  verifying: 3,
  failed: 4,
  completed: 5
} as const;

function truncateCopy(value: string | undefined, max = 180): string | null {
  if (!value) {
    return null;
  }
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 1).trimEnd()}…`;
}

function artifactLinksForJob(job: Job): Array<{ label: string; href: string }> {
  if (!job.artifactPath) {
    return [];
  }

  const base = `${httpBase}/artifacts/github-lane/${job.id}`;
  return [
    { label: "Issue", href: `${base}/issue.json` },
    { label: "Plan", href: `${base}/plan.md` },
    { label: "Patch", href: `${base}/patch.diff` },
    { label: "Tests", href: `${base}/test-output.txt` },
    { label: "PR Draft", href: `${base}/pr-draft.md` },
    { label: "Delivery", href: `${base}/delivery.md` }
  ];
}

function extractTrustDecision(job: Job): string | null {
  const candidates = [job.routingReason, job.blockedReason, job.guardrailSummary].filter(Boolean) as string[];
  for (const value of candidates) {
    const match = value
      .split(/(?<=[.!?])\s+/)
      .find((segment) => /trust|excluded|rejections|qualified|safety policy/i.test(segment));
    if (match) {
      return truncateCopy(match, 118);
    }
  }
  return null;
}

function receiptLabel(receipt: ReceiptRecord): string {
  switch (receipt.action) {
    case "identity_registry_registration":
      return "Identity";
    case "operator_link_validation":
      return "Operator Link";
    case "metadata_update":
      return "Metadata";
    case "reputation_registry_update":
      return "Reputation";
    case "validation_registry_write":
      return "Validation";
  }
}

function correctionBadge(job: Job): { label: string; tone: "active" | "resolved" | "failed" } | null {
  if (job.retries <= 0) {
    return null;
  }
  if (job.status === "completed") {
    return { label: `Self-corrected · ${job.retries} retry${job.retries === 1 ? "" : "ies"}`, tone: "resolved" };
  }
  if (job.status === "failed") {
    return { label: `Correction loop exhausted · ${job.retries} retry${job.retries === 1 ? "" : "ies"}`, tone: "failed" };
  }
  return { label: `Correction loop active · ${job.retries} retry${job.retries === 1 ? "" : "ies"}`, tone: "active" };
}

function correctionCopy(job: Job): string | null {
  if (job.retries <= 0) {
    return null;
  }
  if (job.status === "completed") {
    return "Verification initially rejected the patch, then the builder corrected the work and publish completed.";
  }
  if (job.status === "failed") {
    return "Verification kept rejecting the patch and the job hit its retry budget before publish.";
  }
  return "Verification rejected the first patch and the city routed the job back to execution for another pass.";
}

function githubRepoSlug(referenceUrl: string | undefined): string | null {
  if (!referenceUrl) {
    return null;
  }
  try {
    const url = new URL(referenceUrl);
    if (url.hostname !== "github.com") {
      return null;
    }
    const [owner, repo] = url.pathname.split("/").filter(Boolean);
    return owner && repo ? `${owner}/${repo}` : null;
  } catch {
    return null;
  }
}

function githubBranchName(job: Job): string | null {
  const candidates = [job.guardrailSummary, job.routingReason, job.outputSummary].filter(Boolean) as string[];
  for (const value of candidates) {
    const publishMatch = value.match(/publish branch\s+([^\s|]+)/i);
    if (publishMatch?.[1]) {
      return publishMatch[1];
    }
    const branchMatch = value.match(/branch[:\s]+([^\s|]+)/i);
    if (branchMatch?.[1]) {
      return branchMatch[1];
    }
  }
  return null;
}

function githubWorkflowState(job: Job, artifactLinks: Array<{ label: string; href: string }>): { label: string; tone: "active" | "ready" | "blocked" } | null {
  if (job.category !== "github_bugfix") {
    return null;
  }
  if (job.status === "completed" && artifactLinks.some((artifact) => artifact.label === "PR Draft")) {
    return { label: "PR-ready bundle", tone: "ready" };
  }
  if (job.status === "failed") {
    return { label: "PR blocked", tone: "blocked" };
  }
  return { label: "Preparing PR flow", tone: "active" };
}

export default function App() {
  const [snapshot, setSnapshot] = useState<WorldSnapshot | null>(null);
  const [manifest, setManifest] = useState<AgentManifest | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [receipts, setReceipts] = useState<ReceiptRecord[]>([]);
  const [plugins, setPlugins] = useState<PluginAgentRecord[]>([]);
  const [wsStatus, setWsStatus] = useState<"connecting" | "live" | "offline">("connecting");
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [followAgentId, setFollowAgentId] = useState<string | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(true);
  const [submitJobOpen, setSubmitJobOpen] = useState(false);
  const [plugInAgentOpen, setPlugInAgentOpen] = useState(false);
  const [demoLaunchState, setDemoLaunchState] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [demoLaunchMessage, setDemoLaunchMessage] = useState<string>("");
  const [spotlightMode, setSpotlightMode] = useState(false);
  const [jobsTab, setJobsTab] = useState<"open" | "history">("open");
  const [showLaunchSplash, setShowLaunchSplash] = useState(true);
  const launchStartedAtRef = useRef(performance.now());

  useEffect(() => {
    const controller = new AbortController();

    async function loadBootData(): Promise<void> {
      try {
        const [manifestResponse, pluginResponse] = await Promise.all([
          fetch(`${httpBase}/agent.json`, { signal: controller.signal }),
          fetch(`${httpBase}/plugins`, { signal: controller.signal })
        ]);

        if (manifestResponse.ok) {
          setManifest((await manifestResponse.json()) as AgentManifest);
        }

        if (pluginResponse.ok) {
          setPlugins((await pluginResponse.json()) as PluginAgentRecord[]);
        }
      } catch {
        // ignore boot race while orchestrator starts
      }
    }

    void loadBootData();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;

    const connect = (): void => {
      setWsStatus("connecting");
      socket = new WebSocket(wsBase);

      socket.onopen = () => {
        setWsStatus("live");
      };

      socket.onmessage = (event) => {
        const message = JSON.parse(event.data) as WsMessage;

        if (message.type === "world_snapshot") {
          const incoming = message.payload as WorldSnapshot;
          setSnapshot(incoming);
          setReceipts(incoming.receipts.slice(-10).reverse());
          setPlugins(incoming.pluginAgents);
        }

        if (message.type === "log_entry") {
          const incoming = message.payload as LogEntry;
          setLogs((current) => [incoming, ...current].slice(0, 24));
        }

        if (message.type === "receipt") {
          const payload = message.payload as ReceiptRecord;
          setReceipts((current) => [payload, ...current.filter((entry) => entry.id !== payload.id)].slice(0, 10));
        }

        if (message.type === "plugin_registered") {
          const incoming = message.payload as PluginAgentRecord;
          setPlugins((current) => [incoming, ...current.filter((entry) => entry.id !== incoming.id)]);
        }
      };

      socket.onclose = () => {
        setWsStatus("offline");
        reconnectTimer = window.setTimeout(connect, 1200);
      };

      socket.onerror = () => {
        socket?.close();
      };
    };

    connect();

    return () => {
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }
      socket?.close();
    };
  }, []);

  useEffect(() => {
    if (!spotlightMode) {
      return;
    }

    const timeout = window.setTimeout(() => setSpotlightMode(false), 14000);
    return () => window.clearTimeout(timeout);
  }, [spotlightMode]);

  useEffect(() => {
    if (!showLaunchSplash) {
      return;
    }

    const minimumDisplayMs = 2400;
    const elapsed = performance.now() - launchStartedAtRef.current;
    const timer = window.setTimeout(() => {
      setShowLaunchSplash(false);
    }, Math.max(180, minimumDisplayMs - elapsed));

    return () => window.clearTimeout(timer);
  }, [showLaunchSplash]);

  const jobStats = useMemo(() => {
    if (!snapshot) {
      return { live: 0, completed: 0, failed: 0 };
    }

    return {
      live: snapshot.jobs.filter((job) => job.status !== "completed" && job.status !== "failed").length,
      completed: snapshot.jobs.filter((job) => job.status === "completed").length,
      failed: snapshot.jobs.filter((job) => job.status === "failed").length
    };
  }, [snapshot]);

  const jobsById = useMemo(() => {
    const map = new Map<string, { title: string; category: string }>();
    for (const job of snapshot?.jobs ?? []) {
      map.set(job.id, { title: job.title, category: job.category });
    }
    return map;
  }, [snapshot]);

  const pluginCounts = useMemo(() => {
    return {
      active: plugins.filter((plugin) => plugin.status === "active").length,
      rejected: plugins.filter((plugin) => plugin.status === "rejected").length
    };
  }, [plugins]);

  const openJobs = useMemo(
    () =>
      [...(snapshot?.jobs ?? [])]
        .filter((job) => job.status !== "completed" && job.status !== "failed")
        .sort((left, right) => OPEN_JOB_STATUS_ORDER[left.status] - OPEN_JOB_STATUS_ORDER[right.status]),
    [snapshot?.jobs]
  );

  const jobHistory = useMemo(
    () =>
      [...(snapshot?.jobs ?? [])]
        .filter((job) => job.status === "completed" || job.status === "failed")
        .reverse()
        .slice(0, 8),
    [snapshot?.jobs]
  );

  const onchainStatus: OnchainStatus | null = snapshot?.onchainStatus ?? null;
  const recentChats = useMemo(() => [...(snapshot?.chats ?? [])].slice(-18).reverse(), [snapshot?.chats]);
  const selectedAgent = useMemo(() => (snapshot?.agents ?? []).find((agent) => agent.id === selectedAgentId) ?? null, [snapshot?.agents, selectedAgentId]);
  const launchStatusLabel = snapshot ? "districts online" : wsStatus === "live" ? "hydrating world" : wsStatus === "offline" ? "reconnecting relay" : "linking relay";

  function focusAgent(agentId: string): void {
    setSelectedAgentId(agentId);
    setFocusNonce((current) => current + 1);
    setFollowAgentId(agentId);
  }

  function dismissGuide(): void {
    setGuideOpen(false);
  }

  async function launchDemoJob(): Promise<void> {
    setDemoLaunchState("submitting");
    setDemoLaunchMessage("Sending a GitHub bugfix into the city...");
    setSpotlightMode(false);

    try {
      const response = await fetch(`${httpBase}/jobs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          title: "Patch wallet connect regression",
          summary: "Investigate the wallet connection regression, generate a patch, run tests, and publish delivery artifacts.",
          category: "github_bugfix",
          source: "github",
          submitter: "Demo Console",
          requestedSkills: ["TypeScript", "debugging", "tests"],
          requiredTools: ["github_api", "git", "test_runner"],
          requiredTrust: 0.74,
          deliverable: "Patch artifact with test evidence",
          referenceUrl: "https://github.com/zhentanme/zhentan/issues/12",
          deliveryTarget: "PR-ready patch bundle and verification log"
        })
      });

      if (!response.ok) {
        throw new Error("Request failed");
      }

      const payload = (await response.json()) as { id?: string; title?: string };
      setDemoLaunchState("success");
      setDemoLaunchMessage(
        payload.title
          ? `${payload.title} is live. Watch Open Jobs, Live Handoffs, and Onchain Receipts.`
          : "Demo job launched. Watch Open Jobs, Live Handoffs, and Onchain Receipts."
      );
      setAdvancedOpen(true);
      setSpotlightMode(true);
      dismissGuide();
    } catch {
      setDemoLaunchState("error");
      setDemoLaunchMessage("Demo launch failed. The city may still be starting up.");
    }
  }

  function followActiveAgent(): void {
    const activeAgent =
      (snapshot?.agents ?? []).find((agent) => agent.assignedJobId && agent.phase !== "idle") ??
      (snapshot?.agents ?? []).find((agent) => agent.phase !== "idle") ??
      snapshot?.agents[0];

    if (!activeAgent) {
      return;
    }

    focusAgent(activeAgent.id);
  }

  function formatChatHeader(chat: ChatMessage): string {
    return chat.recipientName ? `${chat.actorName} -> ${chat.recipientName}` : chat.actorName;
  }

  function renderJobCard(job: Job, mode: "open" | "history") {
    const category = JOB_ROUTING[job.category];
    const routingCopy = truncateCopy(job.routingReason, mode === "open" ? 152 : 132);
    const guardrailCopy = truncateCopy(job.guardrailSummary, mode === "open" ? 112 : 96);
    const outputCopy = truncateCopy(job.outputSummary, 124);
    const artifactLinks = artifactLinksForJob(job);
    const trustDecision = extractTrustDecision(job);
    const correction = correctionBadge(job);
    const correctionSummary = correctionCopy(job);
    const repoSlug = githubRepoSlug(job.referenceUrl);
    const branchName = githubBranchName(job);
    const githubWorkflow = githubWorkflowState(job, artifactLinks);

    return (
      <article
        key={job.id}
        className={`job-board-item ${
          job.status === "failed" ? "job-board-item-failed" : job.status === "completed" ? "job-board-item-complete" : "job-board-item-open"
        }`}
      >
        <div className="job-board-topline">
          <span className={`job-status-pill job-status-pill-${job.status}`}>{formatStatus(job.status)}</span>
          <span className="job-category-pill">{category.label}</span>
          {correction ? <span className={`job-correction-pill job-correction-pill-${correction.tone}`}>{correction.label}</span> : null}
        </div>
        <h3>{job.title}</h3>
        <p className="job-board-meta">
          {job.submitter} · {formatRisk(job.riskLevel)} risk · {job.activeStageLabel}
          {job.selectedAgentName ? ` · ${job.selectedAgentName}` : ""}
        </p>
        {job.category === "github_bugfix" ? (
          <div className="job-github-row">
            {repoSlug ? <span className="job-github-pill">Repo {repoSlug}</span> : null}
            {branchName ? <span className="job-github-pill">Branch {branchName}</span> : null}
            {githubWorkflow ? <span className={`job-github-pill job-github-pill-${githubWorkflow.tone}`}>{githubWorkflow.label}</span> : null}
          </div>
        ) : null}
        <div className="job-trust-row">
          <span className="job-trust-pill">Trust floor {job.requiredTrust.toFixed(2)}</span>
          {trustDecision ? <span className="job-trust-note">{trustDecision}</span> : null}
        </div>
        {routingCopy ? <p className="job-board-copy">{routingCopy}</p> : null}
        {guardrailCopy ? <p className="job-board-subcopy">{guardrailCopy}</p> : null}
        {correctionSummary ? <p className={`job-correction-copy job-correction-copy-${correction?.tone ?? "active"}`}>{correctionSummary}</p> : null}
        {job.blockedReason ? <p className="job-board-warning">Blocked: {job.blockedReason}</p> : null}
        {job.referenceUrl ? <p className="job-board-linkline">Reference: {job.referenceUrl}</p> : null}
        {job.deliveryTarget ? <p className="job-board-linkline">Destination: {job.deliveryTarget}</p> : null}
        {mode === "history" && outputCopy ? <p className="job-board-subcopy">Output: {outputCopy}</p> : null}
        {artifactLinks.length > 0 ? (
          <div className="job-artifact-links">
            {artifactLinks.map((artifact) => (
              <a key={artifact.label} href={artifact.href} target="_blank" rel="noreferrer" className="job-artifact-link">
                {artifact.label}
              </a>
            ))}
          </div>
        ) : null}
      </article>
    );
  }

  return (
    <div className="app-shell">
      <main className="layout">
        <section className="scene-column">
          <section className="scene-panel">
            <div className="scene-canvas-shell">
              <WorldScene snapshot={snapshot} selectedAgentId={selectedAgentId} followAgentId={followAgentId} focusNonce={focusNonce} />
            </div>
            <div className="scene-action-dock">
              <button type="button" className="scene-action-button scene-action-button-primary" onClick={() => setSubmitJobOpen(true)}>
                Submit Job
              </button>
              <button type="button" className="scene-action-button" onClick={() => setPlugInAgentOpen(true)}>
                Plug In Your Agent
              </button>
              <button type="button" className="scene-action-button scene-action-button-quiet" onClick={() => setGuideOpen(true)}>
                How it works
              </button>
            </div>
            <div className={`scene-chat-overlay ${spotlightMode ? "spotlight-panel" : ""}`}>
              <div className="scene-chat-head">
                <h2>Live Handoffs</h2>
                <p>{spotlightMode ? "Watch routing decisions and handoffs happen live." : followAgentId ? `Following ${selectedAgent?.name ?? "agent"}` : "Agent-to-agent decisions and delivery updates"}</p>
              </div>
              <div className="scene-chat-list">
                {recentChats.slice(0, 8).map((chat) => (
                  <div key={chat.id} className={`scene-chat-item scene-chat-item-${chat.tone}`}>
                    <p className="scene-chat-actor">
                      {formatChatHeader(chat)}
                      <span className={`scene-chat-kind scene-chat-kind-${chat.kind}`}>{chat.kind.replace(/_/g, " ")}</span>
                    </p>
                    <span className="scene-chat-message">{chat.message}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </section>

        <aside className="side-panel">
          <section className="rail-header" aria-label="Operations rail overview">
            <div>
              <p className="workspace-kicker">Operations Rail</p>
              <p className="rail-header-title">Live city state</p>
            </div>
            <div className="rail-header-meta">
              <span>{openJobs.length} open</span>
              <span>{(snapshot?.agents ?? []).length} agents</span>
            </div>
          </section>

          <section className={`card board-card ${spotlightMode ? "spotlight-panel" : ""}`}>
            <div className="section-head">
              <h2>Jobs</h2>
              <div className="section-tabs" role="tablist" aria-label="Jobs">
                <button
                  type="button"
                  className={`section-tab ${jobsTab === "open" ? "section-tab-active" : ""}`}
                  onClick={() => setJobsTab("open")}
                  role="tab"
                  aria-selected={jobsTab === "open"}
                >
                  Open
                </button>
                <button
                  type="button"
                  className={`section-tab ${jobsTab === "history" ? "section-tab-active" : ""}`}
                  onClick={() => setJobsTab("history")}
                  role="tab"
                  aria-selected={jobsTab === "history"}
                >
                  History
                </button>
              </div>
            </div>
            <p className="section-note">
              {jobsTab === "open"
                ? spotlightMode
                  ? "New demo work appears here first"
                  : openJobs.length > 0
                    ? `${openJobs.length} active in the city`
                    : "No active jobs right now"
                : jobHistory.length > 0
                  ? "Most recent completed and failed work"
                  : "Completed jobs will accumulate here"}
            </p>
            <div className="job-board-list">
              {jobsTab === "open"
                ? openJobs.length > 0
                  ? openJobs.map((job) => renderJobCard(job, "open"))
                  : <p className="empty-state">New work will appear here as soon as it enters the city.</p>
                : jobHistory.length > 0
                  ? jobHistory.map((job) => renderJobCard(job, "history"))
                  : <p className="empty-state">No finished jobs yet.</p>}
            </div>
          </section>

          <section className="card roster-card">
            <div className="section-head">
              <h2>Agent Roster</h2>
              <p className="section-note">{followAgentId ? `Camera locked to ${selectedAgent?.name ?? "agent"}` : "Click to jump behind and follow."}</p>
            </div>
            <div className="roster-list">
              {(snapshot?.agents ?? []).map((agent) => (
                <button
                  type="button"
                  className={`roster-item ${selectedAgentId === agent.id ? "roster-item-active" : ""}`}
                  key={agent.id}
                  onClick={() => focusAgent(agent.id)}
                  onDoubleClick={() => focusAgent(agent.id)}
                >
                  <div>
                    <p className="agent-name">{agent.name}</p>
                    <p className="agent-phase">{formatPhase(agent.phase)}</p>
                    <p className="agent-home">{`${agent.kind === "plugin" ? "Plugin" : "Core"} | Base: ${ROLE_HUBS[agent.role].name}`}</p>
                  </div>
                  <div className="agent-meta">
                    <p>Trust {agent.trustScore.toFixed(2)}</p>
                    <p>Energy {(agent.energy * 100).toFixed(0)}%</p>
                    <p>{agent.assignedJobId ? jobsById.get(agent.assignedJobId)?.title ?? "On job" : "Idle"}</p>
                  </div>
                </button>
              ))}
            </div>
          </section>

          <button type="button" className="advanced-toggle" onClick={() => setAdvancedOpen((current) => !current)}>
            {advancedOpen ? "Hide System Details" : "Show System Details"}
          </button>

          {advancedOpen ? (
            <section className="system-group" aria-label="System details">
              <div className="system-group-head">
                <p className="workspace-kicker">Secondary Surfaces</p>
                <p className="system-group-copy">Receipts, logs, operator context, and runtime state.</p>
              </div>
              <section className="card metrics-card">
                <h2>Runtime Metrics</h2>
                <div className="metric-row">
                  <div>
                    <p className="metric-label">Tick</p>
                    <p className="metric-value">{snapshot?.tick ?? 0}</p>
                  </div>
                  <div>
                    <p className="metric-label">Tool Calls</p>
                    <p className="metric-value">{snapshot?.budget.usedToolCalls ?? 0}</p>
                  </div>
                  <div>
                    <p className="metric-label">Retry Cap</p>
                    <p className="metric-value">{snapshot?.budget.maxRetriesPerJob ?? 0}</p>
                  </div>
                  <div>
                    <p className="metric-label">Chats</p>
                    <p className="metric-value">{snapshot?.chats.length ?? 0}</p>
                  </div>
                </div>
                <p className="budget-line">
                  Tool budget: {snapshot?.budget.usedToolCalls ?? 0}/{snapshot?.budget.maxToolCalls ?? 0}
                </p>
              </section>

              <section className="card manifest-card">
                <h2>City Operator</h2>
                <p className="manifest-item">
                  <span>Name:</span> {manifest?.agentName ?? "loading"}
                </p>
                <p className="manifest-item">
                  <span>Operator:</span> {manifest?.operatorWallet ?? "loading"}
                </p>
                <p className="manifest-item">
                  <span>ERC-8004 ID:</span> {manifest?.erc8004Identity ?? "loading"}
                </p>
                <p className="manifest-item">
                  <span>Mode:</span> Plugin-enabled trust marketplace
                </p>
              </section>

              <section className="card manifest-card">
                <h2>Onchain Status</h2>
                <p className="manifest-item">
                  <span>Writes:</span> {onchainStatus?.enabled ? "Live on Sepolia" : "Simulated only"}
                </p>
                <p className="manifest-item">
                  <span>Reputation:</span> {onchainStatus?.reputationEnabled ? "Enabled" : "Disabled"}
                </p>
                <p className="manifest-item">
                  <span>Validation:</span>{" "}
                  {onchainStatus?.validationEnabled
                    ? "Enabled"
                    : onchainStatus?.validationRequested
                      ? "Requested but unavailable"
                      : "Disabled"}
                </p>
                {!onchainStatus?.validationEnabled && onchainStatus?.validationReason ? (
                  <p className="manifest-item">
                    <span>Validation Note:</span> {onchainStatus.validationReason}
                  </p>
                ) : null}
                <p className="manifest-item">
                  <span>Chain:</span> {onchainStatus?.network ?? "ethereum-sepolia"} ({onchainStatus?.chainId ?? "11155111"})
                </p>
                <p className="manifest-item">
                  <span>Feedback Wallet:</span> {onchainStatus?.feedbackWallet ?? "not configured"}
                </p>
                {!onchainStatus?.enabled && onchainStatus?.disabledReason ? (
                  <p className="manifest-item">
                    <span>Reason:</span> {onchainStatus.disabledReason}
                  </p>
                ) : null}
                <p className="manifest-item">
                  <span>Agent ID:</span> {onchainStatus?.identityAgentId ?? "pending"}
                </p>
              </section>

              <section className="card manifest-card">
                <h2>Plugin Dock</h2>
                <div className="feed-list">
                  {plugins.map((plugin) => (
                    <p key={plugin.id} className={plugin.status === "rejected" ? "log-failure" : "log-onchain"}>
                      [{plugin.status}] {plugin.label}: {plugin.summary}
                    </p>
                  ))}
                </div>
                <p className="budget-line">POST {httpBase}/plugins to plug your agent into the city.</p>
              </section>

              <section className={`card receipt-card ${spotlightMode ? "spotlight-panel" : ""}`}>
                <h2>Onchain Receipts</h2>
                <div className="receipt-list">
                  {receipts.map((receipt) => (
                    <div key={receipt.id} className="receipt-item">
                      <p className={`receipt-mode receipt-mode-${receipt.mode}`}>{receipt.mode === "onchain" ? "live" : "sim"}</p>
                      <div>
                        <div className="receipt-action-row">
                          <p className="receipt-action">{receipt.action.replace(/_/g, " ")}</p>
                          <span className={`receipt-badge receipt-badge-${receipt.action}`}>{receiptLabel(receipt)}</span>
                        </div>
                        <p className="receipt-hash">
                          {receipt.explorerUrl ? (
                            <a href={receipt.explorerUrl} target="_blank" rel="noreferrer">
                              {shortHash(receipt.txHash)}
                            </a>
                          ) : (
                            shortHash(receipt.txHash)
                          )}
                        </p>
                        <p className="receipt-meta">{receipt.jobId ? jobsById.get(receipt.jobId)?.title ?? receipt.jobId : "system receipt"}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="card feed-card">
                <h2>Decision Feed</h2>
                <div className="feed-list">
                  {logs.map((log) => (
                    <p key={log.id} className={`log-${log.type}`}>
                      [{log.type}] {log.actor}: {log.message}
                    </p>
                  ))}
                </div>
              </section>
            </section>
          ) : null}
        </aside>
      </main>

      {!showLaunchSplash && guideOpen ? (
        <div className="guide-modal-shell" role="presentation">
          <div className="guide-modal-backdrop" onClick={dismissGuide} />
          <section className="guide-modal" role="dialog" aria-modal="true" aria-labelledby="guide-modal-title">
            <div className="guide-modal-layout">
              <aside className="guide-modal-brand">
                <p className="workspace-kicker">City Operations</p>
                <TrustCityMark size={110} className="guide-modal-mark" />
                <div>
                  <h2 id="guide-modal-title">Trust City</h2>
                  <p className="guide-modal-copy">
                    A live marketplace where specialized agents discover jobs, coordinate execution, verify outcomes, and deliver with trust-aware routing.
                  </p>
                </div>
                <div className="guide-modal-signals" aria-hidden="true">
                  <span>Autonomous loop</span>
                  <span>Trust receipts</span>
                  <span>Open market</span>
                </div>
              </aside>

              <div className="guide-modal-main">
                <ol className="guide-modal-steps">
                  <li className="guide-modal-step">
                    <span className="guide-modal-step-index">01</span>
                    <div>
                      <h3>Send work into the city</h3>
                      <p>Launch a demo GitHub fix or submit your own job. New work appears in Jobs and begins routing through the market immediately.</p>
                    </div>
                  </li>
                  <li className="guide-modal-step">
                    <span className="guide-modal-step-index">02</span>
                    <div>
                      <h3>Watch agents coordinate</h3>
                      <p>The 3D scene shows agents moving between hubs while Live Handoffs explains each delegation, retry, and delivery decision.</p>
                    </div>
                  </li>
                  <li className="guide-modal-step">
                    <span className="guide-modal-step-index">03</span>
                    <div>
                      <h3>Bring your own agent</h3>
                      <p>Plug in your own agent from the dock to join the market, compete for work, and participate in trust-aware routing.</p>
                    </div>
                  </li>
                </ol>

                <div className="guide-modal-enter">
                  <button type="button" className="workspace-action workspace-action-enter" onClick={dismissGuide}>
                    Enter city
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {submitJobOpen ? (
        <div className="guide-modal-shell" role="presentation">
          <div className="guide-modal-backdrop" onClick={() => setSubmitJobOpen(false)} />
          <div className="action-modal-shell">
            <SubmitJobCard httpBase={httpBase} onClose={() => setSubmitJobOpen(false)} />
          </div>
        </div>
      ) : null}

      {plugInAgentOpen ? (
        <div className="guide-modal-shell" role="presentation">
          <div className="guide-modal-backdrop" onClick={() => setPlugInAgentOpen(false)} />
          <div className="action-modal-shell">
            <PlugInAgentCard httpBase={httpBase} onClose={() => setPlugInAgentOpen(false)} />
          </div>
        </div>
      ) : null}

      {showLaunchSplash ? (
        <div className="launch-splash" role="presentation" aria-hidden={snapshot ? "true" : undefined}>
          <div className="launch-splash-backdrop" />
          <div className="launch-splash-panel">
            <div className="launch-splash-brand">
              <TrustCityMark size={132} className="launch-splash-mark" />
              <div className="launch-splash-copyblock">
                <p className="workspace-kicker">Midnight Exchange</p>
                <h1>Trust City</h1>
                <p className="launch-splash-copy">Launching the autonomous market, syncing the relay, and staging the city.</p>
              </div>
            </div>
            <div className="launch-splash-progress" aria-hidden="true">
              <span className="launch-splash-progress-bar" />
            </div>
            <div className="launch-splash-status">
              <span className={`launch-splash-pill launch-splash-pill-${wsStatus}`}>{wsStatus === "live" ? "relay live" : wsStatus}</span>
              <span>{launchStatusLabel}</span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
