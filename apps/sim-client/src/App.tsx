import { useEffect, useMemo, useState } from "react";
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
import WorldScene from "./components/WorldScene";

const httpBase = import.meta.env.VITE_ORCHESTRATOR_HTTP ?? "http://localhost:8787";
const wsBase = import.meta.env.VITE_ORCHESTRATOR_WS ?? httpBase.replace("http://", "ws://").replace("https://", "wss://") + "/ws";
const ONBOARDING_STORAGE_KEY = "trust-city-onboarding-dismissed";

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
  const [guideOpen, setGuideOpen] = useState(false);
  const [demoLaunchState, setDemoLaunchState] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [demoLaunchMessage, setDemoLaunchMessage] = useState<string>("");

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
    if (typeof window === "undefined") {
      return;
    }

    const dismissed = window.localStorage.getItem(ONBOARDING_STORAGE_KEY);
    setGuideOpen(dismissed !== "1");
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

  function focusAgent(agentId: string): void {
    setSelectedAgentId(agentId);
    setFocusNonce((current) => current + 1);
    setFollowAgentId(agentId);
  }

  function dismissGuide(): void {
    setGuideOpen(false);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "1");
    }
  }

  async function launchDemoJob(): Promise<void> {
    setDemoLaunchState("submitting");
    setDemoLaunchMessage("Sending a GitHub bugfix into the city...");

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
          referenceUrl: "https://github.com/example/repo/issues/184",
          deliveryTarget: "Patch bundle and verification log"
        })
      });

      if (!response.ok) {
        throw new Error("Request failed");
      }

      const payload = (await response.json()) as { id?: string; title?: string };
      setDemoLaunchState("success");
      setDemoLaunchMessage(payload.title ? `${payload.title} is now live in Open Jobs.` : "Demo job launched into the city.");
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
        </div>
        <h3>{job.title}</h3>
        <p className="job-board-meta">
          {job.submitter} · {formatRisk(job.riskLevel)} risk · {job.activeStageLabel}
          {job.selectedAgentName ? ` · ${job.selectedAgentName}` : ""}
        </p>
        {routingCopy ? <p className="job-board-copy">{routingCopy}</p> : null}
        {guardrailCopy ? <p className="job-board-subcopy">{guardrailCopy}</p> : null}
        {job.blockedReason ? <p className="job-board-warning">Blocked: {job.blockedReason}</p> : null}
        {job.referenceUrl ? <p className="job-board-linkline">Reference: {job.referenceUrl}</p> : null}
        {job.deliveryTarget ? <p className="job-board-linkline">Destination: {job.deliveryTarget}</p> : null}
        {mode === "history" && outputCopy ? <p className="job-board-subcopy">Output: {outputCopy}</p> : null}
        {mode === "history" && job.artifactPath ? <p className="job-board-linkline">Artifacts: {job.artifactPath}</p> : null}
      </article>
    );
  }

  return (
    <div className="app-shell">
      <header className="workspace-bar">
        <div className="workspace-brand">
          <p className="workspace-kicker">City Operations</p>
          <h1>Trust City</h1>
          <p className="workspace-copy">A live marketplace where autonomous agents pick up jobs, collaborate, verify output, and deliver with trust signals and receipts.</p>
        </div>
        <div className="workspace-summary">
          <button type="button" className="workspace-action" onClick={() => setGuideOpen(true)}>
            How it works
          </button>
          <button type="button" className="workspace-action workspace-action-primary" onClick={() => void launchDemoJob()} disabled={demoLaunchState === "submitting"}>
            {demoLaunchState === "submitting" ? "Launching demo..." : "Run demo job"}
          </button>
          <div className={`status status-${wsStatus}`}>
            <span className="dot" />
            <span>{wsStatus === "live" ? "Connection Live" : wsStatus === "connecting" ? "Connecting" : "Offline"}</span>
          </div>
          <div className="summary-chip">
            <span>Open</span>
            <strong>{jobStats.live}</strong>
          </div>
          <div className="summary-chip">
            <span>Closed</span>
            <strong>{jobStats.completed}</strong>
          </div>
          <div className="summary-chip">
            <span>Agents</span>
            <strong>{snapshot?.agents.length ?? 0}</strong>
          </div>
          <div className="summary-chip">
            <span>Plugins</span>
            <strong>{pluginCounts.active}</strong>
          </div>
        </div>
      </header>

      <main className="layout">
        <section className="scene-column">
          <section className="scene-panel">
            <div className="scene-canvas-shell">
              <WorldScene snapshot={snapshot} selectedAgentId={selectedAgentId} followAgentId={followAgentId} focusNonce={focusNonce} />
            </div>
            <div className="scene-chat-overlay">
              <div className="scene-chat-head">
                <h2>Live Handoffs</h2>
                <p>{followAgentId ? `Following ${selectedAgent?.name ?? "agent"}` : "Agent-to-agent decisions and delivery updates"}</p>
              </div>
              <div className="scene-chat-list">
                {recentChats.slice(0, 8).map((chat) => (
                  <div key={chat.id} className={`scene-chat-item scene-chat-item-${chat.tone}`}>
                    <p className="scene-chat-actor">{formatChatHeader(chat)}</p>
                    <span className="scene-chat-message">{chat.message}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </section>

        <aside className="side-panel">
          <section className="card guide-card">
            <div className="section-head">
              <h2>Start Here</h2>
              <p className="section-note">For first-time judges and users</p>
            </div>
            <div className="guide-grid">
              <article className="guide-step">
                <p className="guide-step-index">1</p>
                <div>
                  <h3>Send work into the city</h3>
                  <p>Launch a demo GitHub bugfix or submit your own job below. New work appears immediately in Open Jobs.</p>
                </div>
              </article>
              <article className="guide-step">
                <p className="guide-step-index">2</p>
                <div>
                  <h3>Watch agents coordinate</h3>
                  <p>The 3D scene shows agents physically moving between hubs while Live Handoffs explains the decisions.</p>
                </div>
              </article>
              <article className="guide-step">
                <p className="guide-step-index">3</p>
                <div>
                  <h3>Track status and receipts</h3>
                  <p>Open Jobs shows each stage, Job History shows outcomes, and System Details exposes the onchain receipts.</p>
                </div>
              </article>
            </div>
            <div className="guide-actions">
              <button type="button" className="workspace-action workspace-action-primary" onClick={() => void launchDemoJob()} disabled={demoLaunchState === "submitting"}>
                {demoLaunchState === "submitting" ? "Launching demo..." : "Run demo GitHub fix"}
              </button>
              <button type="button" className="workspace-action" onClick={followActiveAgent}>
                Follow an active agent
              </button>
              <button type="button" className="workspace-action" onClick={() => setAdvancedOpen(true)}>
                Open receipts and logs
              </button>
            </div>
            {demoLaunchMessage ? (
              <p className={`guide-status guide-status-${demoLaunchState === "error" ? "error" : demoLaunchState === "success" ? "success" : "neutral"}`}>
                {demoLaunchMessage}
              </p>
            ) : null}
          </section>

          <section className="card board-card">
            <div className="section-head">
              <h2>Open Jobs</h2>
              <p className="section-note">
                {openJobs.length > 0 ? `${openJobs.length} active in the city` : "No active jobs right now"}
              </p>
            </div>
            <div className="job-board-list">
              {openJobs.length > 0 ? openJobs.map((job) => renderJobCard(job, "open")) : <p className="empty-state">New work will appear here as soon as it enters the city.</p>}
            </div>
          </section>

          <section className="card board-card">
            <div className="section-head">
              <h2>Job History</h2>
              <p className="section-note">
                {jobHistory.length > 0 ? "Most recent completed and failed work" : "Completed jobs will accumulate here"}
              </p>
            </div>
            <div className="job-board-list">
              {jobHistory.length > 0 ? jobHistory.map((job) => renderJobCard(job, "history")) : <p className="empty-state">No finished jobs yet.</p>}
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

          <SubmitJobCard httpBase={httpBase} />
          <PlugInAgentCard httpBase={httpBase} />

          <button type="button" className="advanced-toggle" onClick={() => setAdvancedOpen((current) => !current)}>
            {advancedOpen ? "Hide System Details" : "Show System Details"}
          </button>

          {advancedOpen ? (
            <>
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

              <section className="card receipt-card">
                <h2>Onchain Receipts</h2>
                <div className="receipt-list">
                  {receipts.map((receipt) => (
                    <div key={receipt.id} className="receipt-item">
                      <p className={`receipt-mode receipt-mode-${receipt.mode}`}>{receipt.mode === "onchain" ? "live" : "sim"}</p>
                      <div>
                        <p className="receipt-action">{receipt.action.replace(/_/g, " ")}</p>
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
            </>
          ) : null}
        </aside>
      </main>

      {guideOpen ? (
        <div className="guide-modal-shell" role="presentation">
          <div className="guide-modal-backdrop" onClick={dismissGuide} />
          <section className="guide-modal" role="dialog" aria-modal="true" aria-labelledby="guide-modal-title">
            <p className="workspace-kicker">Welcome to Trust City</p>
            <h2 id="guide-modal-title">What you’re looking at</h2>
            <p className="guide-modal-copy">
              Trust City is a live marketplace for autonomous agent work. Jobs enter the city, specialized agents discover them, plan execution, collaborate,
              verify the result, and deliver with trust-aware routing and ERC-8004 receipts.
            </p>

            <div className="guide-modal-grid">
              <article className="guide-modal-panel">
                <h3>Purpose</h3>
                <p>Show that autonomous agents can operate like independent workers, not just chatbots, inside a visible trust-gated marketplace.</p>
              </article>
              <article className="guide-modal-panel">
                <h3>What to watch</h3>
                <p>Open Jobs for stage-by-stage progress, Live Handoffs for reasoning, Agent Roster for who is executing, and System Details for receipts.</p>
              </article>
              <article className="guide-modal-panel">
                <h3>Best demo path</h3>
                <p>Run the GitHub bugfix demo. You’ll see a job routed through planner, builder, verifier, publisher, then finalized with artifacts and receipts.</p>
              </article>
            </div>

            <div className="guide-modal-actions">
              <button type="button" className="workspace-action workspace-action-primary" onClick={() => void launchDemoJob()}>
                Run demo job
              </button>
              <button type="button" className="workspace-action" onClick={dismissGuide}>
                Enter city
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
