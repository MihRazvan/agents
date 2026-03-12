import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import WorldScene from "./components/WorldScene";
const httpBase = import.meta.env.VITE_ORCHESTRATOR_HTTP ?? "http://localhost:8787";
const wsBase = import.meta.env.VITE_ORCHESTRATOR_WS ?? httpBase.replace("http://", "ws://").replace("https://", "wss://") + "/ws";
function formatPhase(phase) {
    return phase.replace(/_/g, " ");
}
function shortHash(hash) {
    if (hash.length < 12) {
        return hash;
    }
    return `${hash.slice(0, 8)}...${hash.slice(-6)}`;
}
export default function App() {
    const [snapshot, setSnapshot] = useState(null);
    const [manifest, setManifest] = useState(null);
    const [logs, setLogs] = useState([]);
    const [receipts, setReceipts] = useState([]);
    const [wsStatus, setWsStatus] = useState("connecting");
    useEffect(() => {
        const controller = new AbortController();
        async function loadManifest() {
            try {
                const response = await fetch(`${httpBase}/agent.json`, { signal: controller.signal });
                if (response.ok) {
                    setManifest((await response.json()));
                }
            }
            catch {
                // ignore boot race while orchestrator starts
            }
        }
        void loadManifest();
        return () => controller.abort();
    }, []);
    useEffect(() => {
        let socket = null;
        let reconnectTimer = null;
        const connect = () => {
            setWsStatus("connecting");
            socket = new WebSocket(wsBase);
            socket.onopen = () => {
                setWsStatus("live");
            };
            socket.onmessage = (event) => {
                const message = JSON.parse(event.data);
                if (message.type === "world_snapshot") {
                    const incoming = message.payload;
                    setSnapshot(incoming);
                    setReceipts(incoming.receipts.slice(-10).reverse());
                }
                if (message.type === "log_entry") {
                    const incoming = message.payload;
                    setLogs((current) => [incoming, ...current].slice(0, 24));
                }
                if (message.type === "receipt") {
                    const payload = message.payload;
                    if (payload.txHash) {
                        setReceipts((current) => [payload.txHash, ...current].slice(0, 10));
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
    return (_jsxs("div", { className: "app-shell", children: [_jsxs("header", { className: "topbar", children: [_jsxs("div", { children: [_jsx("p", { className: "overline", children: "Trust-Gated Autonomous System" }), _jsx("h1", { children: "Trust City Autonomous Ops" })] }), _jsxs("div", { className: `status status-${wsStatus}`, children: [_jsx("span", { className: "dot" }), _jsx("span", { children: wsStatus === "live" ? "Live stream" : wsStatus === "connecting" ? "Connecting" : "Offline" })] })] }), _jsxs("main", { className: "layout", children: [_jsx("section", { className: "scene-panel", children: _jsx(WorldScene, { snapshot: snapshot }) }), _jsxs("aside", { className: "side-panel", children: [_jsxs("section", { className: "card metrics-card", children: [_jsx("h2", { children: "Mission Metrics" }), _jsxs("div", { className: "metric-row", children: [_jsxs("div", { children: [_jsx("p", { className: "metric-label", children: "Tick" }), _jsx("p", { className: "metric-value", children: snapshot?.tick ?? 0 })] }), _jsxs("div", { children: [_jsx("p", { className: "metric-label", children: "Open" }), _jsx("p", { className: "metric-value", children: incidentStats.open })] }), _jsxs("div", { children: [_jsx("p", { className: "metric-label", children: "Resolved" }), _jsx("p", { className: "metric-value", children: incidentStats.resolved })] }), _jsxs("div", { children: [_jsx("p", { className: "metric-label", children: "Failed" }), _jsx("p", { className: "metric-value", children: incidentStats.failed })] })] }), _jsxs("p", { className: "budget-line", children: ["Tool budget: ", snapshot?.budget.usedToolCalls ?? 0, "/", snapshot?.budget.maxToolCalls ?? 0] })] }), _jsxs("section", { className: "card manifest-card", children: [_jsx("h2", { children: "Agent Identity" }), _jsxs("p", { className: "manifest-item", children: [_jsx("span", { children: "Name:" }), " ", manifest?.agentName ?? "loading"] }), _jsxs("p", { className: "manifest-item", children: [_jsx("span", { children: "Operator:" }), " ", manifest?.operatorWallet ?? "loading"] }), _jsxs("p", { className: "manifest-item", children: [_jsx("span", { children: "ERC-8004 ID:" }), " ", manifest?.erc8004Identity ?? "loading"] })] }), _jsxs("section", { className: "card roster-card", children: [_jsx("h2", { children: "Agent Roster" }), _jsx("div", { className: "roster-list", children: (snapshot?.agents ?? []).map((agent) => (_jsxs("div", { className: "roster-item", children: [_jsxs("div", { children: [_jsx("p", { className: "agent-name", children: agent.name }), _jsx("p", { className: "agent-phase", children: formatPhase(agent.phase) })] }), _jsxs("div", { className: "agent-meta", children: [_jsxs("p", { children: ["Trust ", agent.trustScore.toFixed(2)] }), _jsxs("p", { children: ["Energy ", (agent.energy * 100).toFixed(0), "%"] })] })] }, agent.id))) })] }), _jsxs("section", { className: "card receipt-card", children: [_jsx("h2", { children: "Onchain Receipts" }), _jsx("div", { className: "receipt-list", children: receipts.map((receipt) => (_jsx("p", { children: shortHash(receipt) }, receipt))) })] }), _jsxs("section", { className: "card feed-card", children: [_jsx("h2", { children: "Decision Feed" }), _jsx("div", { className: "feed-list", children: logs.map((log) => (_jsxs("p", { className: `log-${log.type}`, children: ["[", log.type, "] ", log.actor, ": ", log.message] }, log.id))) })] })] })] })] }));
}
