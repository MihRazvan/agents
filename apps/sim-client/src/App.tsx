import { useEffect, useMemo, useState } from "react";
import type { AgentManifest, LogEntry, WorldSnapshot, WsMessage } from "@trust-city/shared";
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

export default function App() {
  const [snapshot, setSnapshot] = useState<WorldSnapshot | null>(null);
  const [manifest, setManifest] = useState<AgentManifest | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [receipts, setReceipts] = useState<string[]>([]);
  const [wsStatus, setWsStatus] = useState<"connecting" | "live" | "offline">("connecting");

  useEffect(() => {
    const controller = new AbortController();

    async function loadManifest(): Promise<void> {
      try {
        const response = await fetch(`${httpBase}/agent.json`, { signal: controller.signal });
        if (response.ok) {
          setManifest((await response.json()) as AgentManifest);
        }
      } catch {
        // ignore boot race while orchestrator starts
      }
    }

    void loadManifest();

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
        }

        if (message.type === "log_entry") {
          const incoming = message.payload as LogEntry;
          setLogs((current) => [incoming, ...current].slice(0, 24));
        }

        if (message.type === "receipt") {
          const payload = message.payload as { txHash?: string };
          if (payload.txHash) {
            setReceipts((current) => [payload.txHash!, ...current].slice(0, 10));
          }
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

  const incidentStats = useMemo(() => {
    if (!snapshot) {
      return { open: 0, resolved: 0, failed: 0 };
    }
    return {
      open: snapshot.incidents.filter((incident) => incident.status === "open" || incident.status === "in_progress").length,
      resolved: snapshot.incidents.filter((incident) => incident.status === "resolved").length,
      failed: snapshot.incidents.filter((incident) => incident.status === "failed").length
    };
  }, [snapshot]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="overline">Trust-Gated Autonomous System</p>
          <h1>Trust City Autonomous Ops</h1>
        </div>
        <div className={`status status-${wsStatus}`}>
          <span className="dot" />
          <span>{wsStatus === "live" ? "Live stream" : wsStatus === "connecting" ? "Connecting" : "Offline"}</span>
        </div>
      </header>

      <main className="layout">
        <section className="scene-panel">
          <WorldScene snapshot={snapshot} />
        </section>

        <aside className="side-panel">
          <section className="card metrics-card">
            <h2>Mission Metrics</h2>
            <div className="metric-row">
              <div>
                <p className="metric-label">Tick</p>
                <p className="metric-value">{snapshot?.tick ?? 0}</p>
              </div>
              <div>
                <p className="metric-label">Open</p>
                <p className="metric-value">{incidentStats.open}</p>
              </div>
              <div>
                <p className="metric-label">Resolved</p>
                <p className="metric-value">{incidentStats.resolved}</p>
              </div>
              <div>
                <p className="metric-label">Failed</p>
                <p className="metric-value">{incidentStats.failed}</p>
              </div>
            </div>
            <p className="budget-line">
              Tool budget: {snapshot?.budget.usedToolCalls ?? 0}/{snapshot?.budget.maxToolCalls ?? 0}
            </p>
            <p className="budget-line">
              World seed: {snapshot?.worldSeed ?? 0} | Districts: {snapshot?.districts.length ?? 0}
            </p>
          </section>

          <section className="card manifest-card">
            <h2>Agent Identity</h2>
            <p className="manifest-item">
              <span>Name:</span> {manifest?.agentName ?? "loading"}
            </p>
            <p className="manifest-item">
              <span>Operator:</span> {manifest?.operatorWallet ?? "loading"}
            </p>
            <p className="manifest-item">
              <span>ERC-8004 ID:</span> {manifest?.erc8004Identity ?? "loading"}
            </p>
          </section>

          <section className="card roster-card">
            <h2>Agent Roster</h2>
            <div className="roster-list">
              {(snapshot?.agents ?? []).map((agent) => (
                <div className="roster-item" key={agent.id}>
                  <div>
                    <p className="agent-name">{agent.name}</p>
                    <p className="agent-phase">{formatPhase(agent.phase)}</p>
                  </div>
                  <div className="agent-meta">
                    <p>Trust {agent.trustScore.toFixed(2)}</p>
                    <p>Energy {(agent.energy * 100).toFixed(0)}%</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="card receipt-card">
            <h2>Onchain Receipts</h2>
            <div className="receipt-list">
              {receipts.map((receipt) => (
                <p key={receipt}>{shortHash(receipt)}</p>
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
        </aside>
      </main>
    </div>
  );
}
