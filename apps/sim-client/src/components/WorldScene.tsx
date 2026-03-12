import { Suspense, useEffect, useMemo, useRef, useState, type MutableRefObject, type RefObject } from "react";
import { Bloom, EffectComposer, Noise, Vignette } from "@react-three/postprocessing";
import { Float, Html, Line, OrbitControls, Sky, Stars, Text } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import * as THREE from "three";
import { AGENT_COLORS, DISTRICT_THEME_PURPOSE, INCIDENT_ROUTING, ROLE_HUBS, type District, type Incident, type Vec2, type WorldSnapshot } from "@trust-city/shared";
import AnimatedAgentAvatar from "./AnimatedAgentAvatar";

interface Props {
  snapshot: WorldSnapshot | null;
}

type StructureKind = "tower" | "midrise" | "house" | "warehouse" | "institution" | "park" | "tree";

interface CityStructure {
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  hue: number;
  kind: StructureKind;
  districtTheme: District["theme"];
  lod: "near" | "far";
}

interface RoadLine {
  axis: "h" | "v";
  x: number;
  z: number;
  length: number;
  kind: "major" | "minor";
  width: number;
}

const CHUNK_SIZE = 48;
const LOT_SIZE = 6;
const ROAD_MAJOR_SPACING = 24;
const ROAD_MINOR_SPACING = 12;
const ROAD_MAJOR_HALF_WIDTH = 1.6;
const ROAD_MINOR_HALF_WIDTH = 0.8;
const NEAR_CHUNK_RADIUS = 2;
const FAR_CHUNK_RADIUS = 4;
const USER_CONTROL_PAUSE_MS = 9000;

function hashNumber(seed: number, x: number, y: number): number {
  let value = (seed ^ (x * 374761393) ^ (y * 668265263)) >>> 0;
  value = (value ^ (value >> 13)) >>> 0;
  value = (Math.imul(value, 1274126177) ^ (value >> 16)) >>> 0;
  return value / 4294967295;
}

function toWorldPoint(position: Vec2, y = 0.72): [number, number, number] {
  return [position.x, y, position.y];
}

function toPathPoint(position: Vec2): [number, number, number] {
  return [position.x, 0.35, position.y];
}

function severityRank(severity: Incident["severity"]): number {
  if (severity === "high") {
    return 3;
  }
  if (severity === "medium") {
    return 2;
  }
  return 1;
}

function getFocusPoint(snapshot: WorldSnapshot | null): Vec2 {
  if (!snapshot) {
    return { x: 0, y: 0 };
  }

  const activeIncidents = snapshot.incidents.filter((incident) => incident.status === "open" || incident.status === "in_progress");
  const focusIncident =
    activeIncidents.find((incident) => incident.id === snapshot.cinematicFocus) ??
    activeIncidents.sort((a, b) => severityRank(b.severity) - severityRank(a.severity))[0];

  if (focusIncident) {
    return focusIncident.position;
  }

  if (snapshot.agents.length === 0) {
    return { x: 0, y: 0 };
  }

  const sum = snapshot.agents.reduce(
    (acc, agent) => {
      acc.x += agent.position.x;
      acc.y += agent.position.y;
      return acc;
    },
    { x: 0, y: 0 }
  );

  return {
    x: sum.x / snapshot.agents.length,
    y: sum.y / snapshot.agents.length
  };
}

function distanceToGridLine(value: number, spacing: number): number {
  const mod = ((value % spacing) + spacing) % spacing;
  return Math.min(mod, spacing - mod);
}

function roadTypeAt(value: number): "major" | "minor" | "none" {
  if (distanceToGridLine(value, ROAD_MAJOR_SPACING) <= ROAD_MAJOR_HALF_WIDTH) {
    return "major";
  }
  if (distanceToGridLine(value, ROAD_MINOR_SPACING) <= ROAD_MINOR_HALF_WIDTH) {
    return "minor";
  }
  return "none";
}

function nearestDistrictTheme(position: Vec2, districts: District[]): District["theme"] {
  if (districts.length === 0) {
    return "core";
  }
  let best: District | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const district of districts) {
    const dx = district.center.x - position.x;
    const dz = district.center.y - position.y;
    const distanceSq = dx * dx + dz * dz;
    if (distanceSq < bestDistance) {
      bestDistance = distanceSq;
      best = district;
    }
  }
  return best?.theme ?? "core";
}

function districtHue(theme: District["theme"]): number {
  if (theme === "core") {
    return 198;
  }
  if (theme === "industrial") {
    return 28;
  }
  if (theme === "research") {
    return 222;
  }
  return 122;
}

function pickStructureKind(
  theme: District["theme"],
  selectionRoll: number,
  greeneryRoll: number,
  occupancyRoll: number,
  lod: "near" | "far"
): StructureKind | null {
  const occupancyByTheme: Record<District["theme"], number> = {
    core: lod === "near" ? 0.52 : 0.22,
    industrial: lod === "near" ? 0.44 : 0.2,
    research: lod === "near" ? 0.4 : 0.18,
    residential: lod === "near" ? 0.34 : 0.15
  };

  if (occupancyRoll > occupancyByTheme[theme]) {
    return null;
  }

  const parkChanceByTheme: Record<District["theme"], number> = {
    core: 0.05,
    industrial: 0.07,
    research: 0.14,
    residential: 0.22
  };
  if (greeneryRoll < parkChanceByTheme[theme]) {
    return greeneryRoll < parkChanceByTheme[theme] * 0.45 ? "tree" : "park";
  }

  if (theme === "core") {
    if (selectionRoll < 0.5) {
      return "tower";
    }
    if (selectionRoll < 0.83) {
      return "midrise";
    }
    return "institution";
  }
  if (theme === "industrial") {
    if (selectionRoll < 0.54) {
      return "warehouse";
    }
    if (selectionRoll < 0.78) {
      return "midrise";
    }
    return "institution";
  }
  if (theme === "research") {
    if (selectionRoll < 0.46) {
      return "institution";
    }
    if (selectionRoll < 0.72) {
      return "midrise";
    }
    return "tower";
  }
  if (selectionRoll < 0.56) {
    return "house";
  }
  if (selectionRoll < 0.82) {
    return "midrise";
  }
  return "institution";
}

function buildChunkStructures(seed: number, cx: number, cz: number, lod: "near" | "far", districts: District[]): CityStructure[] {
  const chunkMinX = cx * CHUNK_SIZE - CHUNK_SIZE / 2;
  const chunkMinZ = cz * CHUNK_SIZE - CHUNK_SIZE / 2;
  const lotsPerSide = Math.floor(CHUNK_SIZE / LOT_SIZE);
  const output: CityStructure[] = [];

  for (let lz = 0; lz < lotsPerSide; lz += 1) {
    for (let lx = 0; lx < lotsPerSide; lx += 1) {
      const x = chunkMinX + lx * LOT_SIZE + LOT_SIZE / 2;
      const z = chunkMinZ + lz * LOT_SIZE + LOT_SIZE / 2;

      if (roadTypeAt(x) !== "none" || roadTypeAt(z) !== "none") {
        continue;
      }

      const theme = nearestDistrictTheme({ x, y: z }, districts);
      const occupancyRoll = hashNumber(seed + 5, cx * 53 + lx * 11, cz * 71 + lz * 17);
      const selectionRoll = hashNumber(seed + 17, cx * 83 + lx * 31, cz * 37 + lz * 13);
      const greeneryRoll = hashNumber(seed + 31, cx * 29 + lx * 7, cz * 97 + lz * 19);
      const scaleRoll = hashNumber(seed + 47, cx * 107 + lx * 23, cz * 43 + lz * 27);

      const kind = pickStructureKind(theme, selectionRoll, greeneryRoll, occupancyRoll, lod);
      if (!kind) {
        continue;
      }

      let width = 2.5;
      let depth = 2.5;
      let height = 3.5;

      if (kind === "tower") {
        width = 2.4 + scaleRoll * 1.8;
        depth = 2.4 + (1 - scaleRoll) * 1.6;
        height = (lod === "near" ? 14 : 8) + scaleRoll * (lod === "near" ? 20 : 10);
      } else if (kind === "midrise") {
        width = 2.6 + scaleRoll * 1.6;
        depth = 2.4 + (1 - scaleRoll) * 1.4;
        height = (lod === "near" ? 6.5 : 4.2) + scaleRoll * (lod === "near" ? 7.5 : 4.5);
      } else if (kind === "house") {
        width = 2.2 + scaleRoll * 1.2;
        depth = 2 + (1 - scaleRoll) * 1.4;
        height = (lod === "near" ? 1.5 : 1.2) + scaleRoll * (lod === "near" ? 1.3 : 0.8);
      } else if (kind === "warehouse") {
        width = 3.6 + scaleRoll * 1.9;
        depth = 3.2 + (1 - scaleRoll) * 1.7;
        height = (lod === "near" ? 2.8 : 2.1) + scaleRoll * (lod === "near" ? 2.6 : 1.2);
      } else if (kind === "institution") {
        width = 3.2 + scaleRoll * 1.5;
        depth = 3 + (1 - scaleRoll) * 1.5;
        height = (lod === "near" ? 4.5 : 3.1) + scaleRoll * (lod === "near" ? 4.1 : 2.4);
      } else if (kind === "park") {
        width = 4.2 + scaleRoll * 1.5;
        depth = 4 + (1 - scaleRoll) * 1.6;
        height = 0.12;
      } else if (kind === "tree") {
        width = 0.45;
        depth = 0.45;
        height = 1.9 + scaleRoll * 2.4;
      }

      output.push({
        x,
        z,
        width,
        depth,
        height,
        hue: districtHue(theme) + Math.floor((scaleRoll - 0.5) * 18),
        kind,
        districtTheme: theme,
        lod
      });
    }
  }

  return output;
}

function buildStreamedCity(seed: number, focusPoint: Vec2, districts: District[]): { near: CityStructure[]; far: CityStructure[]; roads: RoadLine[] } {
  const focusChunkX = Math.round(focusPoint.x / CHUNK_SIZE);
  const focusChunkZ = Math.round(focusPoint.y / CHUNK_SIZE);

  const near: CityStructure[] = [];
  const far: CityStructure[] = [];

  for (let dz = -FAR_CHUNK_RADIUS; dz <= FAR_CHUNK_RADIUS; dz += 1) {
    for (let dx = -FAR_CHUNK_RADIUS; dx <= FAR_CHUNK_RADIUS; dx += 1) {
      const cx = focusChunkX + dx;
      const cz = focusChunkZ + dz;
      const dist = Math.max(Math.abs(dx), Math.abs(dz));

      if (dist <= NEAR_CHUNK_RADIUS) {
        near.push(...buildChunkStructures(seed, cx, cz, "near", districts));
      } else {
        far.push(...buildChunkStructures(seed, cx, cz, "far", districts));
      }
    }
  }

  const minChunkX = focusChunkX - FAR_CHUNK_RADIUS - 1;
  const maxChunkX = focusChunkX + FAR_CHUNK_RADIUS + 1;
  const minChunkZ = focusChunkZ - FAR_CHUNK_RADIUS - 1;
  const maxChunkZ = focusChunkZ + FAR_CHUNK_RADIUS + 1;
  const minX = (minChunkX - 0.5) * CHUNK_SIZE;
  const maxX = (maxChunkX + 0.5) * CHUNK_SIZE;
  const minZ = (minChunkZ - 0.5) * CHUNK_SIZE;
  const maxZ = (maxChunkZ + 0.5) * CHUNK_SIZE;
  const roads: RoadLine[] = [];

  const xStart = Math.floor(minX / ROAD_MINOR_SPACING) * ROAD_MINOR_SPACING;
  const zStart = Math.floor(minZ / ROAD_MINOR_SPACING) * ROAD_MINOR_SPACING;

  for (let x = xStart; x <= maxX; x += ROAD_MINOR_SPACING) {
    const kind = roadTypeAt(x) === "major" ? "major" : "minor";
    roads.push({
      axis: "v",
      x,
      z: (minZ + maxZ) * 0.5,
      length: maxZ - minZ,
      kind,
      width: kind === "major" ? ROAD_MAJOR_HALF_WIDTH * 2 : ROAD_MINOR_HALF_WIDTH * 2
    });
  }

  for (let z = zStart; z <= maxZ; z += ROAD_MINOR_SPACING) {
    const kind = roadTypeAt(z) === "major" ? "major" : "minor";
    roads.push({
      axis: "h",
      x: (minX + maxX) * 0.5,
      z,
      length: maxX - minX,
      kind,
      width: kind === "major" ? ROAD_MAJOR_HALF_WIDTH * 2 : ROAD_MINOR_HALF_WIDTH * 2
    });
  }

  return { near, far, roads };
}

function StructureBlock({ structure }: { structure: CityStructure }) {
  const saturation = structure.kind === "park" || structure.kind === "tree" ? 38 : structure.lod === "near" ? 36 : 26;
  const lightness = structure.kind === "park" || structure.kind === "tree" ? 22 : structure.lod === "near" ? 17 : 13;
  const color = new THREE.Color(`hsl(${structure.hue}, ${saturation}%, ${lightness}%)`);
  const emissive = new THREE.Color(`hsl(${structure.hue}, ${structure.kind === "park" || structure.kind === "tree" ? 24 : 75}%, ${structure.lod === "near" ? 22 : 12}%)`);

  if (structure.kind === "tree") {
    const canopyColor = new THREE.Color(`hsl(${structure.districtTheme === "residential" ? 126 : 118}, 34%, 28%)`);
    return (
      <group position={[structure.x, 0, structure.z]}>
        <mesh position={[0, structure.height * 0.3, 0]} castShadow={structure.lod === "near"} receiveShadow>
          <cylinderGeometry args={[0.12, 0.16, structure.height * 0.6, 8]} />
          <meshStandardMaterial color="#5e4026" roughness={0.88} />
        </mesh>
        <mesh position={[0, structure.height * 0.78, 0]} castShadow={structure.lod === "near"}>
          <sphereGeometry args={[0.62, 10, 10]} />
          <meshStandardMaterial color={canopyColor} emissive={canopyColor} emissiveIntensity={0.12} roughness={0.8} />
        </mesh>
      </group>
    );
  }

  if (structure.kind === "park") {
    return (
      <group position={[structure.x, 0.01, structure.z]}>
        <mesh receiveShadow>
          <boxGeometry args={[structure.width, 0.05, structure.depth]} />
          <meshStandardMaterial color="#264d2f" emissive="#2f6b3a" emissiveIntensity={0.25} metalness={0.08} roughness={0.88} />
        </mesh>
        {structure.lod === "near" ? (
          <mesh position={[structure.width * 0.25, 0.26, -structure.depth * 0.2]}>
            <sphereGeometry args={[0.2, 8, 8]} />
            <meshStandardMaterial color="#3e8b52" emissive="#3e8b52" emissiveIntensity={0.16} />
          </mesh>
        ) : null}
      </group>
    );
  }

  if (structure.kind === "house") {
    return (
      <group position={[structure.x, 0, structure.z]}>
        <mesh position={[0, structure.height * 0.42, 0]} castShadow={structure.lod === "near"} receiveShadow>
          <boxGeometry args={[structure.width, structure.height * 0.84, structure.depth]} />
          <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={0.22} roughness={0.56} metalness={0.12} />
        </mesh>
        {structure.lod === "near" ? (
          <mesh position={[0, structure.height * 0.95, 0]} castShadow>
            <coneGeometry args={[Math.max(structure.width, structure.depth) * 0.58, structure.height * 0.38, 4]} />
            <meshStandardMaterial color="#59383a" emissive="#59383a" emissiveIntensity={0.18} roughness={0.72} />
          </mesh>
        ) : null}
      </group>
    );
  }

  if (structure.kind === "institution") {
    return (
      <group position={[structure.x, 0, structure.z]}>
        <mesh position={[0, structure.height / 2, 0]} castShadow={structure.lod === "near"} receiveShadow>
          <boxGeometry args={[structure.width, structure.height, structure.depth]} />
          <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={0.28} metalness={0.3} roughness={0.44} />
        </mesh>
        {structure.lod === "near" ? (
          <mesh position={[0, structure.height + 0.32, 0]} castShadow>
            <sphereGeometry args={[Math.min(structure.width, structure.depth) * 0.2, 10, 8]} />
            <meshStandardMaterial color="#9ed7ff" emissive="#9ed7ff" emissiveIntensity={0.42} roughness={0.25} metalness={0.45} />
          </mesh>
        ) : null}
      </group>
    );
  }

  if (structure.kind === "warehouse") {
    return (
      <group position={[structure.x, 0, structure.z]}>
        <mesh position={[0, structure.height * 0.5, 0]} castShadow={structure.lod === "near"} receiveShadow>
          <boxGeometry args={[structure.width, structure.height, structure.depth]} />
          <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={0.18} metalness={0.2} roughness={0.68} />
        </mesh>
        {structure.lod === "near" ? (
          <mesh position={[structure.width * 0.2, structure.height + 0.12, 0]}>
            <boxGeometry args={[structure.width * 0.5, 0.08, structure.depth * 0.24]} />
            <meshStandardMaterial color="#5f6a73" roughness={0.72} metalness={0.14} />
          </mesh>
        ) : null}
      </group>
    );
  }

  return (
    <mesh position={[structure.x, structure.height / 2, structure.z]} castShadow={structure.lod === "near"} receiveShadow>
      <boxGeometry args={[structure.width, structure.height, structure.depth]} />
      <meshStandardMaterial
        color={color}
        emissive={emissive}
        emissiveIntensity={structure.kind === "tower" ? 0.3 : 0.2}
        metalness={structure.kind === "tower" ? 0.45 : 0.25}
        roughness={structure.kind === "tower" ? 0.4 : 0.56}
      />
    </mesh>
  );
}

function DynamicRoads({ roads }: { roads: RoadLine[] }) {
  return (
    <group>
      {roads.map((road) => {
        const color = road.kind === "major" ? "#2f3642" : "#222b34";

        return (
          <mesh key={`${road.axis}-${road.x}-${road.z}`} position={[road.x, 0.02, road.z]}>
            <boxGeometry args={road.axis === "h" ? [road.length, 0.04, road.width] : [road.width, 0.04, road.length]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={road.kind === "major" ? 0.2 : 0.1} roughness={0.92} />
          </mesh>
        );
      })}
    </group>
  );
}

function DistrictOverlay({ snapshot }: { snapshot: WorldSnapshot }) {
  return (
    <group>
      {snapshot.districts.map((district) => {
        const semantics = DISTRICT_THEME_PURPOSE[district.theme];
        const hue = district.theme === "core" ? "#59e4ff" : district.theme === "industrial" ? "#ff8f66" : district.theme === "research" ? "#89a0ff" : "#89ffb3";
        const preferred = semantics.preferredCategories.map((category) => category.replace("_", " ")).join(", ");
        return (
          <group key={district.id} position={[district.center.x, 0, district.center.y]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[district.radius - 0.14, district.radius, 64]} />
              <meshStandardMaterial color={hue} emissive={hue} emissiveIntensity={0.65} transparent opacity={0.25} />
            </mesh>
            <Html position={[0, 0.24, district.radius + 0.86]} center>
              <div className="world-tag world-tag-district">
                <p>{district.name}</p>
                <span>{`Preferred incidents: ${preferred}`}</span>
              </div>
            </Html>
          </group>
        );
      })}
    </group>
  );
}

function RoleHubLandmarks() {
  const hubs = useMemo(() => Object.entries(ROLE_HUBS), []);
  const spinePoints = useMemo(() => hubs.map(([, hub]) => [hub.position.x, 0.09, hub.position.y] as [number, number, number]), [hubs]);

  return (
    <group>
      {hubs.map(([role, hub]) => {
        const color = AGENT_COLORS[role as keyof typeof AGENT_COLORS];
        return (
          <group key={role} position={[hub.position.x, 0, hub.position.y]}>
            <mesh position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0.6, 0.9, 40]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.3} transparent opacity={0.42} />
            </mesh>
            <mesh position={[0, 0.38, 0]}>
              <cylinderGeometry args={[0.08, 0.14, 0.62, 12]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.8} metalness={0.2} roughness={0.3} />
            </mesh>
            <Html position={[0, 1.08, 0]} center>
              <div className="world-tag world-tag-hub">
                <p>{hub.name}</p>
                <span>{hub.purpose}</span>
              </div>
            </Html>
          </group>
        );
      })}
      {spinePoints.length > 1 ? <Line points={spinePoints} color="#6dc8ff" lineWidth={2} transparent opacity={0.42} /> : null}
      <Html position={[-0.7, 0.32, ROLE_HUBS.builder.position.y - 1.7]} center>
        <div className="world-tag world-tag-spine">
          <p>Operations Spine</p>
        </div>
      </Html>
    </group>
  );
}

function TrafficLanes({ center }: { center: Vec2 }) {
  const movers = useMemo(() => {
    return Array.from({ length: 20 }).map((_, index) => ({
      id: index,
      lane: (index % 2 === 0 ? "h" : "v") as "h" | "v",
      laneOffset: ((index % 5) - 2) * ROAD_MINOR_SPACING,
      offset: index * 1.3,
      speed: 0.24 + (index % 6) * 0.04,
      span: 220,
      color: index % 3 === 0 ? "#7ad8ff" : index % 3 === 1 ? "#ffd56f" : "#9ae8a4"
    }));
  }, []);

  return (
    <group>
      {movers.map((mover) => (
        <TrafficNode key={mover.id} center={center} {...mover} />
      ))}
    </group>
  );
}

function TrafficNode(props: { lane: "h" | "v"; laneOffset: number; offset: number; speed: number; span: number; color: string; center: Vec2 }) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (!meshRef.current) {
      return;
    }
    const t = clock.getElapsedTime() * props.speed + props.offset;
    const oscillation = ((t % props.span) / props.span) * 2 - 1;

    if (props.lane === "h") {
      meshRef.current.position.set(props.center.x + oscillation * 110, 0.09, props.center.y + props.laneOffset);
      meshRef.current.rotation.y = Math.PI / 2;
    } else {
      meshRef.current.position.set(props.center.x + props.laneOffset, 0.09, props.center.y + oscillation * 110);
      meshRef.current.rotation.y = 0;
    }
  });

  return (
    <mesh ref={meshRef}>
      <boxGeometry args={[0.28, 0.12, 0.16]} />
      <meshStandardMaterial color={props.color} emissive={props.color} emissiveIntensity={0.65} metalness={0.24} roughness={0.25} />
    </mesh>
  );
}

function IncidentBeacon({ incident }: { incident: Incident }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const [x, y, z] = toWorldPoint(incident.position);
  const routing = INCIDENT_ROUTING[incident.category];

  useFrame(({ clock }) => {
    const pulse = 1 + Math.sin(clock.getElapsedTime() * 3.3 + incident.position.x) * 0.15;
    if (meshRef.current) {
      meshRef.current.scale.setScalar(pulse);
    }
    if (ringRef.current) {
      ringRef.current.rotation.x += 0.02;
      ringRef.current.rotation.z += 0.012;
      ringRef.current.scale.setScalar(1.15 + Math.sin(clock.getElapsedTime() * 2) * 0.08);
    }
  });

  const tone = incident.severity === "high" ? "#ff4e4e" : incident.severity === "medium" ? "#ffb454" : "#6fe78b";

  return (
    <group position={[x, y, z]}>
      <Float speed={2.1} rotationIntensity={0.2} floatIntensity={0.12}>
        <mesh ref={meshRef} castShadow>
          <octahedronGeometry args={[0.37, 0]} />
          <meshStandardMaterial color={tone} emissive={tone} emissiveIntensity={1.45} metalness={0.1} roughness={0.25} />
        </mesh>
      </Float>
      <mesh ref={ringRef} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.82, 0.03, 8, 28]} />
        <meshStandardMaterial color={tone} emissive={tone} emissiveIntensity={0.8} transparent opacity={0.85} />
      </mesh>
      <Html position={[0, 1.05, 0]} center>
        <div className="world-tag world-tag-incident">
          <p>{routing.zoneName}</p>
          <span>{incident.category.replace("_", " ")}</span>
        </div>
      </Html>
    </group>
  );
}

function CameraDirector({ snapshot, controlsRef, autoPausedUntilRef }: { snapshot: WorldSnapshot | null; controlsRef: RefObject<OrbitControlsImpl | null>; autoPausedUntilRef: MutableRefObject<number> }) {
  const targetRef = useRef(new THREE.Vector3(0, 1.2, 1));

  useFrame((_, delta) => {
    const controls = controlsRef.current;
    if (!snapshot || !controls) {
      return;
    }

    if (performance.now() < autoPausedUntilRef.current) {
      return;
    }

    const focus = getFocusPoint(snapshot);
    targetRef.current.set(focus.x, 1.35, focus.y);

    controls.target.lerp(targetRef.current, Math.min(1, delta * 1.85));
    controls.update();
  });

  return null;
}

function FreeRoamController({
  controlsRef,
  autoPausedUntilRef
}: {
  controlsRef: RefObject<OrbitControlsImpl | null>;
  autoPausedUntilRef: MutableRefObject<number>;
}) {
  const keysRef = useRef<Record<string, boolean>>({});
  const velocityRef = useRef(new THREE.Vector3());
  const forwardRef = useRef(new THREE.Vector3());
  const rightRef = useRef(new THREE.Vector3());
  const upRef = useRef(new THREE.Vector3(0, 1, 0));
  const desiredVelocityRef = useRef(new THREE.Vector3());
  const stepRef = useRef(new THREE.Vector3());

  useEffect(() => {
    const movementKeys = new Set(["w", "a", "s", "d", "q", "e", "arrowup", "arrowdown", "arrowleft", "arrowright"]);
    const down = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (movementKeys.has(key)) {
        event.preventDefault();
      }
      keysRef.current[key] = true;
    };
    const up = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (movementKeys.has(key)) {
        event.preventDefault();
      }
      keysRef.current[key] = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  useFrame((_, delta) => {
    const controls = controlsRef.current;
    if (!controls) {
      return;
    }

    const keys = keysRef.current;
    const forwardInput = (keys["w"] || keys["arrowup"] ? 1 : 0) - (keys["s"] || keys["arrowdown"] ? 1 : 0);
    const strafeInput = (keys["d"] || keys["arrowright"] ? 1 : 0) - (keys["a"] || keys["arrowleft"] ? 1 : 0);
    const verticalInput = (keys["e"] ? 1 : 0) - (keys["q"] ? 1 : 0);
    const hasInput = forwardInput !== 0 || strafeInput !== 0 || verticalInput !== 0;

    const speed = (keys["shift"] ? 36 : 16) * (keys["control"] ? 0.35 : 1);
    const forward = forwardRef.current;
    controls.object.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();

    const right = rightRef.current;
    right.crossVectors(forward, upRef.current).normalize();

    const desiredVelocity = desiredVelocityRef.current;
    desiredVelocity.set(0, 0, 0);
    desiredVelocity.addScaledVector(forward, forwardInput * speed);
    desiredVelocity.addScaledVector(right, strafeInput * speed);
    desiredVelocity.addScaledVector(upRef.current, verticalInput * speed * 0.8);

    const blend = 1 - Math.exp(-delta * 10);
    velocityRef.current.lerp(desiredVelocity, blend);

    if (!hasInput && velocityRef.current.lengthSq() < 0.001) {
      return;
    }

    const step = stepRef.current.copy(velocityRef.current).multiplyScalar(delta);
    controls.object.position.add(step);
    controls.target.add(step);
    controls.update();

    if (hasInput) {
      autoPausedUntilRef.current = performance.now() + USER_CONTROL_PAUSE_MS;
    }
  });

  return null;
}

function StreamAnchorController({
  controlsRef,
  onAnchorChunkChange
}: {
  controlsRef: RefObject<OrbitControlsImpl | null>;
  onAnchorChunkChange: (anchor: Vec2) => void;
}) {
  const chunkRef = useRef<string>("");

  useFrame(() => {
    const controls = controlsRef.current;
    if (!controls) {
      return;
    }

    const position = controls.object.position;
    const chunkX = Math.round(position.x / CHUNK_SIZE);
    const chunkZ = Math.round(position.z / CHUNK_SIZE);
    const chunkKey = `${chunkX}:${chunkZ}`;

    if (chunkKey !== chunkRef.current) {
      chunkRef.current = chunkKey;
      onAnchorChunkChange({ x: chunkX * CHUNK_SIZE, y: chunkZ * CHUNK_SIZE });
    }
  });

  return null;
}

export default function WorldScene({ snapshot }: Props) {
  const focusPoint = useMemo(() => getFocusPoint(snapshot), [snapshot]);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const autoPausedUntilRef = useRef(0);
  const userControllingRef = useRef(false);
  const [streamAnchor, setStreamAnchor] = useState<Vec2>(focusPoint);

  useEffect(() => {
    setStreamAnchor((current) => {
      if (Math.hypot(current.x - focusPoint.x, current.y - focusPoint.y) < CHUNK_SIZE) {
        return focusPoint;
      }
      return current;
    });
  }, [focusPoint.x, focusPoint.y]);

  const streamedCity = useMemo(() => {
    return buildStreamedCity(snapshot?.worldSeed ?? 271828, streamAnchor, snapshot?.districts ?? []);
  }, [snapshot?.worldSeed, snapshot?.districts, streamAnchor.x, streamAnchor.y]);

  const [trailMap, setTrailMap] = useState<Record<string, Array<[number, number, number]>>>({});

  useEffect(() => {
    if (!snapshot) {
      return;
    }

    setTrailMap((current) => {
      const next: Record<string, Array<[number, number, number]>> = { ...current };
      for (const agent of snapshot.agents) {
        const agentTrail = [...(next[agent.id] ?? []), toPathPoint(agent.position)];
        next[agent.id] = agentTrail.slice(-64);
      }
      return next;
    });
  }, [snapshot]);

  const incidentsById = useMemo(() => {
    const map = new Map<string, Incident>();
    for (const incident of snapshot?.incidents ?? []) {
      map.set(incident.id, incident);
    }
    return map;
  }, [snapshot?.incidents]);

  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      camera={{ position: [36, 24, 34], fov: 48 }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
    >
      <color attach="background" args={["#080b15"]} />
      <fog attach="fog" args={["#080b15", 80, 360]} />

      <ambientLight intensity={0.44} color="#8ea9ff" />
      <directionalLight
        position={[14, 24, 10]}
        intensity={1.42}
        color="#d3e3ff"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <spotLight position={[-14, 18, -8]} intensity={120} distance={120} angle={0.33} penumbra={0.7} color="#4ad8ff" />

      <Sky distance={1800} sunPosition={[110, 40, 70]} turbidity={8} rayleigh={0.4} mieCoefficient={0.004} mieDirectionalG={0.9} />
      <Stars radius={220} depth={120} count={7000} factor={4.5} fade saturation={0} speed={1.1} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[streamAnchor.x, 0, streamAnchor.y]}>
        <planeGeometry args={[960, 960, 1, 1]} />
        <meshStandardMaterial color="#151b26" metalness={0.08} roughness={0.95} />
      </mesh>

      <DynamicRoads roads={streamedCity.roads} />
      <TrafficLanes center={streamAnchor} />

      {snapshot ? <DistrictOverlay snapshot={snapshot} /> : null}
      <RoleHubLandmarks />

      {streamedCity.far.map((structure) => (
        <StructureBlock key={`far-${structure.x}-${structure.z}-${structure.kind}`} structure={structure} />
      ))}
      {streamedCity.near.map((structure) => (
        <StructureBlock key={`near-${structure.x}-${structure.z}-${structure.kind}`} structure={structure} />
      ))}

      {(snapshot?.incidents ?? [])
        .filter((incident) => incident.status === "open" || incident.status === "in_progress")
        .map((incident) => (
          <IncidentBeacon key={incident.id} incident={incident} />
        ))}

      <Suspense fallback={null}>
        {(snapshot?.agents ?? []).map((agent) => (
          <AnimatedAgentAvatar
            key={agent.id}
            agent={agent}
            incident={agent.assignedIncidentId ? incidentsById.get(agent.assignedIncidentId) : undefined}
          />
        ))}
      </Suspense>

      {Object.entries(trailMap).map(([agentId, points]) => {
        if (points.length < 2) {
          return null;
        }
        const agent = snapshot?.agents.find((candidate) => candidate.id === agentId);
        const color = agent ? AGENT_COLORS[agent.role] : "#9ecbff";
        return <Line key={agentId} points={points} color={color} lineWidth={1.4} transparent opacity={0.35} />;
      })}

      {(snapshot?.receipts ?? []).slice(-6).map((txHash, index) => (
        <group key={txHash} position={[focusPoint.x + 28, 0.8 + index * 1.1, focusPoint.y - 14]}>
          <mesh>
            <torusGeometry args={[0.3, 0.08, 9, 22]} />
            <meshStandardMaterial color="#56ffd9" emissive="#56ffd9" emissiveIntensity={1.35} metalness={0.2} roughness={0.15} />
          </mesh>
          <Text position={[0.9, 0, 0]} fontSize={0.12} color="#d7fffa" anchorX="left" anchorY="middle">
            {txHash.slice(0, 10)}
          </Text>
        </group>
      ))}

      <CameraDirector snapshot={snapshot} controlsRef={controlsRef} autoPausedUntilRef={autoPausedUntilRef} />
      <FreeRoamController controlsRef={controlsRef} autoPausedUntilRef={autoPausedUntilRef} />
      <StreamAnchorController controlsRef={controlsRef} onAnchorChunkChange={setStreamAnchor} />
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableDamping
        dampingFactor={0.07}
        enablePan
        zoomSpeed={1.12}
        rotateSpeed={0.74}
        minDistance={6}
        maxDistance={220}
        maxPolarAngle={Math.PI / 2.02}
        onStart={() => {
          userControllingRef.current = true;
          autoPausedUntilRef.current = performance.now() + USER_CONTROL_PAUSE_MS;
        }}
        onChange={() => {
          if (userControllingRef.current) {
            autoPausedUntilRef.current = performance.now() + USER_CONTROL_PAUSE_MS;
          }
        }}
        onEnd={() => {
          userControllingRef.current = false;
          autoPausedUntilRef.current = performance.now() + USER_CONTROL_PAUSE_MS;
        }}
      />

      <EffectComposer>
        <Bloom intensity={1.16} luminanceThreshold={0.2} luminanceSmoothing={0.58} mipmapBlur />
        <Noise opacity={0.03} />
        <Vignette offset={0.15} darkness={0.62} eskil={false} />
      </EffectComposer>
    </Canvas>
  );
}
