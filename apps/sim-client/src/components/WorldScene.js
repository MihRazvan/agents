import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bloom, EffectComposer, Noise, Vignette } from "@react-three/postprocessing";
import { Float, Line, OrbitControls, Sky, Stars, Text } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { AGENT_COLORS } from "@trust-city/shared";
function toWorldPoint(position) {
    return [position.x, 0.72, position.y];
}
function toPathPoint(position) {
    return [position.x, 0.35, position.y];
}
function BuildingBlock({ building }) {
    const color = new THREE.Color(`hsl(${building.hue}, 42%, 20%)`);
    const emissive = new THREE.Color(`hsl(${building.hue}, 100%, 25%)`);
    return (_jsxs("mesh", { position: [building.x, building.height / 2, building.z], castShadow: true, receiveShadow: true, children: [_jsx("boxGeometry", { args: [building.width, building.height, building.depth] }), _jsx("meshStandardMaterial", { color: color, emissive: emissive, emissiveIntensity: 0.2, metalness: 0.45, roughness: 0.45 })] }));
}
function AgentAvatar({ agent }) {
    const groupRef = useRef(null);
    useFrame(({ clock }) => {
        if (!groupRef.current) {
            return;
        }
        groupRef.current.position.y = 0.72 + Math.sin(clock.getElapsedTime() * 4 + agent.position.x) * 0.05;
    });
    const [x, y, z] = toWorldPoint(agent.position);
    const color = AGENT_COLORS[agent.role];
    return (_jsxs("group", { ref: groupRef, position: [x, y, z], children: [_jsxs("mesh", { castShadow: true, children: [_jsx("capsuleGeometry", { args: [0.24, 0.45, 4, 12] }), _jsx("meshStandardMaterial", { color: color, emissive: color, emissiveIntensity: 0.7, metalness: 0.25, roughness: 0.2 })] }), _jsxs("mesh", { position: [0, 0.6, 0], castShadow: true, children: [_jsx("coneGeometry", { args: [0.18, 0.25, 12] }), _jsx("meshStandardMaterial", { color: color, emissive: color, emissiveIntensity: 0.95, metalness: 0.15, roughness: 0.1 })] }), _jsx(Text, { position: [0, 1.08, 0], fontSize: 0.16, color: "#e8f1ff", anchorX: "center", anchorY: "bottom", maxWidth: 4, children: agent.name })] }));
}
function IncidentBeacon({ incident }) {
    const meshRef = useRef(null);
    const ringRef = useRef(null);
    const [x, y, z] = toWorldPoint(incident.position);
    useFrame(({ clock }) => {
        const pulse = 1 + Math.sin(clock.getElapsedTime() * 3.3 + incident.position.x) * 0.15;
        if (meshRef.current) {
            meshRef.current.scale.setScalar(pulse);
        }
        if (ringRef.current) {
            ringRef.current.rotation.x += 0.02;
            ringRef.current.rotation.z += 0.01;
            ringRef.current.scale.setScalar(1.15 + Math.sin(clock.getElapsedTime() * 2) * 0.08);
        }
    });
    const tone = incident.severity === "high" ? "#ff4e4e" : incident.severity === "medium" ? "#ffb454" : "#6fe78b";
    return (_jsxs("group", { position: [x, y, z], children: [_jsx(Float, { speed: 2.1, rotationIntensity: 0.2, floatIntensity: 0.12, children: _jsxs("mesh", { ref: meshRef, castShadow: true, children: [_jsx("octahedronGeometry", { args: [0.37, 0] }), _jsx("meshStandardMaterial", { color: tone, emissive: tone, emissiveIntensity: 1.5, metalness: 0.1, roughness: 0.25 })] }) }), _jsxs("mesh", { ref: ringRef, rotation: [Math.PI / 2, 0, 0], children: [_jsx("torusGeometry", { args: [0.82, 0.03, 8, 28] }), _jsx("meshStandardMaterial", { color: tone, emissive: tone, emissiveIntensity: 0.8, transparent: true, opacity: 0.85 })] }), _jsx(Text, { position: [0, 0.92, 0], fontSize: 0.14, color: "#e9f5ff", anchorX: "center", anchorY: "bottom", maxWidth: 4.5, children: incident.category })] }));
}
function NeonRoads(props) {
    return (_jsxs("group", { ...props, children: [Array.from({ length: 7 }).map((_, index) => {
                const z = -10 + index * 4;
                return (_jsxs("mesh", { position: [0, 0.02, z], children: [_jsx("boxGeometry", { args: [34, 0.04, 0.16] }), _jsx("meshStandardMaterial", { color: "#49d3ff", emissive: "#49d3ff", emissiveIntensity: 1.6 })] }, `h-${index}`));
            }), Array.from({ length: 9 }).map((_, index) => {
                const x = -16 + index * 4;
                return (_jsxs("mesh", { position: [x, 0.02, 2.5], children: [_jsx("boxGeometry", { args: [0.16, 0.04, 24] }), _jsx("meshStandardMaterial", { color: "#8f7cff", emissive: "#8f7cff", emissiveIntensity: 1.1 })] }, `v-${index}`));
            })] }));
}
export default function WorldScene({ snapshot }) {
    const buildings = useMemo(() => {
        const list = [];
        for (let gx = -4; gx <= 4; gx += 1) {
            for (let gz = -2; gz <= 4; gz += 1) {
                if (Math.abs(gx) <= 1 && Math.abs(gz - 1) <= 1) {
                    continue;
                }
                const jitterX = ((gx * 17 + gz * 13) % 10) * 0.09;
                const jitterZ = ((gx * 11 + gz * 5) % 10) * 0.08;
                const height = 1.8 + Math.abs((gx * 9 + gz * 7) % 17) * 0.32;
                list.push({
                    x: gx * 4 + jitterX,
                    z: gz * 4 + jitterZ,
                    width: 1.4 + Math.abs((gx + gz) % 4) * 0.2,
                    depth: 1.4 + Math.abs((gx - gz) % 4) * 0.2,
                    height,
                    hue: 190 + ((gx * 12 + gz * 17 + 360) % 120)
                });
            }
        }
        return list;
    }, []);
    const [trailMap, setTrailMap] = useState({});
    useEffect(() => {
        if (!snapshot) {
            return;
        }
        setTrailMap((current) => {
            const next = { ...current };
            for (const agent of snapshot.agents) {
                const agentTrail = [...(next[agent.id] ?? []), toPathPoint(agent.position)];
                next[agent.id] = agentTrail.slice(-40);
            }
            return next;
        });
    }, [snapshot]);
    return (_jsxs(Canvas, { shadows: true, dpr: [1, 1.75], camera: { position: [18, 18, 21], fov: 46 }, gl: { antialias: true, powerPreference: "high-performance" }, children: [_jsx("color", { attach: "background", args: ["#080b15"] }), _jsx("fog", { attach: "fog", args: ["#080b15", 20, 58] }), _jsx("ambientLight", { intensity: 0.4, color: "#8ea9ff" }), _jsx("directionalLight", { position: [14, 24, 10], intensity: 1.4, color: "#d3e3ff", castShadow: true, "shadow-mapSize-width": 2048, "shadow-mapSize-height": 2048 }), _jsx("spotLight", { position: [-14, 18, -8], intensity: 120, distance: 80, angle: 0.33, penumbra: 0.7, color: "#4ad8ff" }), _jsx(Sky, { distance: 1200, sunPosition: [110, 40, 70], turbidity: 8, rayleigh: 0.4, mieCoefficient: 0.004, mieDirectionalG: 0.9 }), _jsx(Stars, { radius: 120, depth: 70, count: 4000, factor: 4.5, fade: true, saturation: 0, speed: 1.2 }), _jsxs("mesh", { rotation: [-Math.PI / 2, 0, 0], receiveShadow: true, children: [_jsx("planeGeometry", { args: [80, 80, 1, 1] }), _jsx("meshStandardMaterial", { color: "#0b1320", metalness: 0.6, roughness: 0.45 })] }), _jsx(NeonRoads, {}), buildings.map((building) => (_jsx(BuildingBlock, { building: building }, `${building.x}-${building.z}`))), (snapshot?.incidents ?? [])
                .filter((incident) => incident.status === "open" || incident.status === "in_progress")
                .map((incident) => (_jsx(IncidentBeacon, { incident: incident }, incident.id))), (snapshot?.agents ?? []).map((agent) => (_jsx(AgentAvatar, { agent: agent }, agent.id))), Object.entries(trailMap).map(([agentId, points]) => {
                if (points.length < 2) {
                    return null;
                }
                const agent = snapshot?.agents.find((candidate) => candidate.id === agentId);
                const color = agent ? AGENT_COLORS[agent.role] : "#9ecbff";
                return _jsx(Line, { points: points, color: color, lineWidth: 1.6, transparent: true, opacity: 0.45 }, agentId);
            }), (snapshot?.receipts ?? []).slice(-6).map((txHash, index) => (_jsxs("group", { position: [18, 0.8 + index * 1.1, -8], children: [_jsxs("mesh", { children: [_jsx("torusGeometry", { args: [0.3, 0.08, 9, 22] }), _jsx("meshStandardMaterial", { color: "#56ffd9", emissive: "#56ffd9", emissiveIntensity: 1.35, metalness: 0.2, roughness: 0.15 })] }), _jsx(Text, { position: [0.9, 0, 0], fontSize: 0.12, color: "#d7fffa", anchorX: "left", anchorY: "middle", children: txHash.slice(0, 10) })] }, txHash))), _jsx(OrbitControls, { makeDefault: true, maxDistance: 46, minDistance: 13, target: [0, 1, 2], maxPolarAngle: Math.PI / 2.1 }), _jsxs(EffectComposer, { children: [_jsx(Bloom, { intensity: 1.15, luminanceThreshold: 0.2, luminanceSmoothing: 0.6, mipmapBlur: true }), _jsx(Noise, { opacity: 0.035 }), _jsx(Vignette, { offset: 0.16, darkness: 0.62, eskil: false })] })] }));
}
