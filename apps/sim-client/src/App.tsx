import { useEffect, useMemo, useState } from "react";
import {
  JOB_ROUTING,
  ROLE_HUBS,
  type AgentManifest,
  type ChatMessage,
  type LogEntry,
  type OnchainStatus,
  type PluginAgentRecord,
  type ReceiptRecord,
  type WorldSnapshot,
  type WsMessage
} from "@trust-city/shared";
import SubmitJobCard from "./components/SubmitJobCard";
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

  const onchainStatus: OnchainStatus | null = snapshot?.onchainStatus ?? null;
  const recentChats = useMemo(() => [...(snapshot?.chats ?? [])].slice(-18).reverse(), [snapshot?.chats]);
  const selectedAgent = useMemo(() => (snapshot?.agents ?? []).find((agent) => agent.id === selectedAgentId) ?? null, [snapshot?.agents, selectedAgentId]);

  function focusAgent(agentId: string): void {
    setSelectedAgentId(agentId);
    setFocusNonce((current) => current + 1);
    setFollowAgentId(agentId);
  }

  function formatChatHeader(chat: ChatMessage): string {
    return chat.recipientName ? `${chat.actorName} -> ${chat.recipientName}` : chat.actorName;
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="overline">Open Autonomous Work Market</p>
          <h1>Trust City Exchange</h1>
        </div>
        <div className={`status status-${wsStatus}`}>
          <span className="dot" />
          <span>{wsStatus === "live" ? "Live stream" : wsStatus === "connecting" ? "Connecting" : "Offline"}</span>
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
                <h2>Live Chat</h2>
                <p>{followAgentId ? `Following ${selectedAgent?.name ?? "agent"}` : "Auto-follow armed"}</p>
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
          <section className="card metrics-card">
            <h2>Market Metrics</h2>
            <div className="metric-row">
              <div>
                <p className="metric-label">Tick</p>
                <p className="metric-value">{snapshot?.tick ?? 0}</p>
              </div>
              <div>
                <p className="metric-label">Live Jobs</p>
                <p className="metric-value">{jobStats.live}</p>
              </div>
              <div>
                <p className="metric-label">Completed</p>
                <p className="metric-value">{jobStats.completed}</p>
              </div>
              <div>
                <p className="metric-label">Plugins</p>
                <p className="metric-value">{pluginCounts.active}</p>
              </div>
            </div>
            <p className="budget-line">
              Tool budget: {snapshot?.budget.usedToolCalls ?? 0}/{snapshot?.budget.maxToolCalls ?? 0}
            </p>
            <p className="budget-line">
              Retry budget: {snapshot?.budget.maxRetriesPerJob ?? 0} | Active chats: {snapshot?.chats.length ?? 0}
            </p>
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

          <button type="button" className="advanced-toggle" onClick={() => setAdvancedOpen((current) => !current)}>
            {advancedOpen ? "Hide Advanced" : "Show Advanced"}
          </button>

          {advancedOpen ? (
            <>
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

              <section className="card manifest-card">
                <h2>Live Jobs</h2>
                <div className="feed-list">
                  {(snapshot?.jobs ?? []).map((job) => (
                    <div
                      key={job.id}
                      className={`job-detail-card ${
                        job.status === "failed" ? "job-detail-failed" : job.status === "completed" ? "job-detail-complete" : "job-detail-live"
                      }`}
                    >
                      <p className="job-detail-title">
                        [{formatStatus(job.status)}] {job.title}
                      </p>
                      <p className="job-detail-meta">
                        {JOB_ROUTING[job.category].label} | {job.submitter} | {formatRisk(job.riskLevel)} risk | Stage {job.activeStageLabel}
                      </p>
                      <p className="job-detail-copy">{job.routingReason}</p>
                      <p className="job-detail-copy">{job.guardrailSummary}</p>
                      {job.referenceUrl ? <p className="job-detail-copy">Reference: {job.referenceUrl}</p> : null}
                      {job.deliveryTarget ? <p className="job-detail-copy">Destination: {job.deliveryTarget}</p> : null}
                      {job.blockedReason ? <p className="job-detail-copy job-detail-warning">Blocked: {job.blockedReason}</p> : null}
                      {job.outputSummary ? <p className="job-detail-copy">Output: {job.outputSummary}</p> : null}
                      {job.artifactPath ? <p className="job-detail-copy">Artifacts: {job.artifactPath}</p> : null}
                    </div>
                  ))}
                </div>
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
    </div>
  );
}
