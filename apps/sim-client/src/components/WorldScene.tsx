import { Suspense, useEffect, useMemo, useRef, useState, type MutableRefObject, type RefObject } from "react";
import { Bloom, EffectComposer, Noise, Vignette } from "@react-three/postprocessing";
import { Float, Line, OrbitControls, Sky, Stars, Text } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import * as THREE from "three";
import { AGENT_COLORS, DISTRICT_THEME_PURPOSE, INCIDENT_ROUTING, ROLE_HUBS, type Incident, type Vec2, type WorldSnapshot } from "@trust-city/shared";
import AnimatedAgentAvatar from "./AnimatedAgentAvatar";

interface Props {
  snapshot: WorldSnapshot | null;
}

interface Building {
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  hue: number;
  lod: "near" | "far";
}

interface RoadLine {
  axis: "h" | "v";
  x: number;
  z: number;
  length: number;
}

const CHUNK_SIZE = 24;
const NEAR_CHUNK_RADIUS = 3;
const FAR_CHUNK_RADIUS = 6;
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

function buildChunkBuildings(seed: number, cx: number, cz: number, lod: "near" | "far"): Building[] {
  const countBase = lod === "near" ? 7 : 2;
  const count = countBase + Math.floor(hashNumber(seed + 11, cx, cz) * (lod === "near" ? 5 : 3));
  const originX = cx * CHUNK_SIZE;
  const originZ = cz * CHUNK_SIZE;
  const spread = CHUNK_SIZE * 0.75;

  const output: Building[] = [];

  for (let i = 0; i < count; i += 1) {
    const n1 = hashNumber(seed + i * 13, cx * 97 + i * 17, cz * 53 + i * 5);
    const n2 = hashNumber(seed + i * 19, cx * 31 + i * 11, cz * 71 + i * 7);
    const n3 = hashNumber(seed + i * 23, cx * 43 + i * 3, cz * 89 + i * 29);

    output.push({
      x: originX + (n1 - 0.5) * spread,
      z: originZ + (n2 - 0.5) * spread,
      width: (lod === "near" ? 1.1 : 1.8) + n2 * (lod === "near" ? 2.1 : 3.3),
      depth: (lod === "near" ? 1.1 : 1.8) + n1 * (lod === "near" ? 2.0 : 3.1),
      height: (lod === "near" ? 4.5 : 2.8) + n3 * (lod === "near" ? 20 : 10),
      hue: 175 + Math.floor(n1 * 145),
      lod
    });
  }

  return output;
}

function buildStreamedCity(seed: number, focusPoint: Vec2): { near: Building[]; far: Building[]; roads: RoadLine[] } {
  const focusChunkX = Math.round(focusPoint.x / CHUNK_SIZE);
  const focusChunkZ = Math.round(focusPoint.y / CHUNK_SIZE);

  const near: Building[] = [];
  const far: Building[] = [];

  for (let dz = -FAR_CHUNK_RADIUS; dz <= FAR_CHUNK_RADIUS; dz += 1) {
    for (let dx = -FAR_CHUNK_RADIUS; dx <= FAR_CHUNK_RADIUS; dx += 1) {
      const cx = focusChunkX + dx;
      const cz = focusChunkZ + dz;
      const dist = Math.max(Math.abs(dx), Math.abs(dz));

      if (dist <= NEAR_CHUNK_RADIUS) {
        near.push(...buildChunkBuildings(seed, cx, cz, "near"));
      } else {
        far.push(...buildChunkBuildings(seed, cx, cz, "far"));
      }
    }
  }

  const minChunkX = focusChunkX - FAR_CHUNK_RADIUS - 1;
  const maxChunkX = focusChunkX + FAR_CHUNK_RADIUS + 1;
  const minChunkZ = focusChunkZ - FAR_CHUNK_RADIUS - 1;
  const maxChunkZ = focusChunkZ + FAR_CHUNK_RADIUS + 1;

  const minX = minChunkX * CHUNK_SIZE;
  const maxX = maxChunkX * CHUNK_SIZE;
  const minZ = minChunkZ * CHUNK_SIZE;
  const maxZ = maxChunkZ * CHUNK_SIZE;

  const roads: RoadLine[] = [];
  for (let x = minX; x <= maxX; x += 8) {
    roads.push({ axis: "v", x, z: (minZ + maxZ) * 0.5, length: maxZ - minZ });
  }
  for (let z = minZ; z <= maxZ; z += 8) {
    roads.push({ axis: "h", x: (minX + maxX) * 0.5, z, length: maxX - minX });
  }

  return { near, far, roads };
}

function BuildingBlock({ building }: { building: Building }) {
  const color = new THREE.Color(`hsl(${building.hue}, ${building.lod === "near" ? 42 : 32}%, ${building.lod === "near" ? 17 : 13}%)`);
  const emissive = new THREE.Color(`hsl(${building.hue}, 100%, ${building.lod === "near" ? 24 : 14}%)`);

  return (
    <mesh position={[building.x, building.height / 2, building.z]} castShadow={building.lod === "near"} receiveShadow>
      <boxGeometry args={[building.width, building.height, building.depth]} />
      <meshStandardMaterial
        color={color}
        emissive={emissive}
        emissiveIntensity={building.lod === "near" ? 0.25 : 0.12}
        metalness={building.lod === "near" ? 0.5 : 0.35}
        roughness={building.lod === "near" ? 0.4 : 0.55}
      />
    </mesh>
  );
}

function DynamicRoads({ roads }: { roads: RoadLine[] }) {
  return (
    <group>
      {roads.map((road, index) => {
        const isPrimary = index % 6 === 0;
        const color = road.axis === "h" ? "#49d3ff" : "#8f7cff";
        const width = isPrimary ? 0.24 : 0.13;

        return (
          <mesh key={`${road.axis}-${road.x}-${road.z}`} position={[road.x, 0.02, road.z]}>
            <boxGeometry args={road.axis === "h" ? [road.length, 0.04, width] : [width, 0.04, road.length]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={isPrimary ? 1.35 : 0.75} />
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
        const preferred = semantics.preferredCategories.map((category) => category.replace("_", " ")).join(" / ");
        return (
          <group key={district.id} position={[district.center.x, 0, district.center.y]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[district.radius - 0.14, district.radius, 64]} />
              <meshStandardMaterial color={hue} emissive={hue} emissiveIntensity={0.65} transparent opacity={0.25} />
            </mesh>
            <Text position={[0, 0.1, district.radius + 0.55]} fontSize={0.18} color="#daf3ff" anchorX="center" anchorY="middle">
              {district.name}
            </Text>
            <Text position={[0, 0.1, district.radius + 1]} fontSize={0.12} color="#b8d9ff" anchorX="center" anchorY="middle" maxWidth={10}>
              {semantics.purpose}
            </Text>
            <Text position={[0, 0.1, district.radius + 1.34]} fontSize={0.11} color="#95b6dd" anchorX="center" anchorY="middle">
              {`Preferred: ${preferred}`}
            </Text>
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
            <Text position={[0, 0.95, 0]} fontSize={0.15} color="#ecf6ff" anchorX="center" anchorY="bottom">
              {hub.name}
            </Text>
            <Text position={[0, 0.77, 0]} fontSize={0.11} color="#b9dcff" anchorX="center" anchorY="bottom" maxWidth={6}>
              {hub.purpose}
            </Text>
          </group>
        );
      })}
      {spinePoints.length > 1 ? <Line points={spinePoints} color="#6dc8ff" lineWidth={2} transparent opacity={0.42} /> : null}
      <Text position={[-0.7, 0.22, ROLE_HUBS.builder.position.y - 1.7]} fontSize={0.14} color="#9ecfff" anchorX="center" anchorY="middle">
        Operations Spine
      </Text>
    </group>
  );
}

function TrafficLanes({ center }: { center: Vec2 }) {
  const movers = useMemo(() => {
    return Array.from({ length: 36 }).map((_, index) => ({
      id: index,
      lane: (index % 2 === 0 ? "h" : "v") as "h" | "v",
      offset: index * 1.3,
      speed: 0.44 + (index % 7) * 0.06,
      span: 120,
      color: index % 3 === 0 ? "#67dfff" : index % 3 === 1 ? "#ba9cff" : "#94ff7b"
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

function TrafficNode(props: { lane: "h" | "v"; offset: number; speed: number; span: number; color: string; center: Vec2 }) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (!meshRef.current) {
      return;
    }
    const t = clock.getElapsedTime() * props.speed + props.offset;
    const oscillation = ((t % props.span) / props.span) * 2 - 1;

    if (props.lane === "h") {
      meshRef.current.position.set(props.center.x + oscillation * 55, 0.12, props.center.y - 24 + Math.sin(props.offset) * 14);
    } else {
      meshRef.current.position.set(props.center.x - 36 + Math.cos(props.offset * 0.75) * 24, 0.12, props.center.y + oscillation * 48);
    }
  });

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[0.08, 10, 10]} />
      <meshStandardMaterial color={props.color} emissive={props.color} emissiveIntensity={1.5} metalness={0.15} roughness={0.12} />
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
      <Text position={[0, 0.92, 0]} fontSize={0.14} color="#e9f5ff" anchorX="center" anchorY="bottom" maxWidth={4.5}>
        {routing.zoneName}
      </Text>
      <Text position={[0, 0.74, 0]} fontSize={0.11} color="#c5daef" anchorX="center" anchorY="bottom">
        {incident.category.replace("_", " ")}
      </Text>
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
    return buildStreamedCity(snapshot?.worldSeed ?? 271828, streamAnchor);
  }, [snapshot?.worldSeed, streamAnchor.x, streamAnchor.y]);

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
        <planeGeometry args={[700, 700, 1, 1]} />
        <meshStandardMaterial color="#0b1320" metalness={0.6} roughness={0.45} />
      </mesh>

      <DynamicRoads roads={streamedCity.roads} />
      <TrafficLanes center={streamAnchor} />

      {snapshot ? <DistrictOverlay snapshot={snapshot} /> : null}
      <RoleHubLandmarks />

      {streamedCity.far.map((building) => (
        <BuildingBlock key={`far-${building.x}-${building.z}`} building={building} />
      ))}
      {streamedCity.near.map((building) => (
        <BuildingBlock key={`near-${building.x}-${building.z}`} building={building} />
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
