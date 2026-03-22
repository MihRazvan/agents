import { useMemo, useRef } from "react";
import { Float, Html, Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { AGENT_COLORS, DISTRICT_THEME_PURPOSE, JOB_ROUTING, ROLE_HUBS, type Job, type PluginAgentRecord, type Vec2, type WorldSnapshot } from "@trust-city/shared";
import { ROAD_MINOR_SPACING, type CityStructure, type RoadLine } from "./generator";

function toWorldPoint(position: Vec2, y = 0.72): [number, number, number] {
  return [position.x, y, position.y];
}

export function StructureBlock({ structure }: { structure: CityStructure }) {
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

export function DynamicRoads({ roads }: { roads: RoadLine[] }) {
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

export function DistrictOverlay({ snapshot, selectedAgentId }: { snapshot: WorldSnapshot; selectedAgentId?: string | null }) {
  const selectedAgent = selectedAgentId ? snapshot.agents.find((agent) => agent.id === selectedAgentId) : undefined;
  return (
    <group>
      {snapshot.districts.map((district) => {
        const semantics = DISTRICT_THEME_PURPOSE[district.theme];
        const hue = district.theme === "core" ? "#59e4ff" : district.theme === "industrial" ? "#ff8f66" : district.theme === "research" ? "#89a0ff" : "#89ffb3";
        const isSelectedHome = selectedAgent?.homeDistrictId === district.id;
        return (
          <group key={district.id} position={[district.center.x, 0, district.center.y]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[district.radius - 0.14, district.radius, 64]} />
              <meshStandardMaterial color={hue} emissive={hue} emissiveIntensity={0.65} transparent opacity={isSelectedHome ? 0.4 : 0.14} />
            </mesh>
            <Html position={[0, 0.24, district.radius + 0.86]} center>
              <div className={`world-tag world-tag-district ${isSelectedHome ? "world-tag-district-active" : ""}`}>
                <p>{district.name}</p>
                <span>{isSelectedHome ? semantics.purpose : `${JOB_ROUTING[semantics.preferredCategories[0]].label} zone`}</span>
              </div>
            </Html>
          </group>
        );
      })}
    </group>
  );
}

export function RoleHubLandmarks() {
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
              </div>
            </Html>
          </group>
        );
      })}
      {spinePoints.length > 1 ? <Line points={spinePoints} color="#6dc8ff" lineWidth={2} transparent opacity={0.42} /> : null}
      <Html position={[24, 0.32, -18]} center>
        <div className="world-tag world-tag-spine">
          <p>Marketplace Spine</p>
        </div>
      </Html>
    </group>
  );
}

export function PluginRegistryBoard({ plugins }: { plugins: PluginAgentRecord[] }) {
  const active = plugins.filter((plugin) => plugin.status === "active");
  const rejected = plugins.filter((plugin) => plugin.status === "rejected");

  return (
    <group position={[ROLE_HUBS.scout.position.x + 8, 0, ROLE_HUBS.scout.position.y + 8]}>
      <mesh position={[0, 0.8, 0]}>
        <boxGeometry args={[3.2, 1.5, 0.18]} />
        <meshStandardMaterial color="#0d1c30" emissive="#163555" emissiveIntensity={0.34} metalness={0.2} roughness={0.45} />
      </mesh>
      <Html position={[0, 1.68, 0]} center>
        <div className="world-tag world-tag-plugin">
          <p>Plugin Registry</p>
          <span>{`${active.length} active | ${rejected.length} rejected`}</span>
        </div>
      </Html>
      {plugins.slice(0, 4).map((plugin, index) => {
        const tone = plugin.status === "active" ? "#7dffb1" : "#ff7d7d";
        return (
          <group key={plugin.id} position={[-1.1 + index * 0.75, 0.26, 0.42]}>
            <mesh>
              <cylinderGeometry args={[0.12, 0.12, 0.4, 10]} />
              <meshStandardMaterial color={tone} emissive={tone} emissiveIntensity={0.88} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

export function TrafficLanes({ center }: { center: Vec2 }) {
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

export function JobBeacon({ job }: { job: Job }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const [x, y, z] = toWorldPoint(job.position);
  const routing = JOB_ROUTING[job.category];

  useFrame(({ clock }) => {
    const pulse = 1 + Math.sin(clock.getElapsedTime() * 3.3 + job.position.x) * 0.15;
    if (meshRef.current) {
      meshRef.current.scale.setScalar(pulse);
    }
    if (ringRef.current) {
      ringRef.current.rotation.x += 0.02;
      ringRef.current.rotation.z += 0.012;
      ringRef.current.scale.setScalar(1.15 + Math.sin(clock.getElapsedTime() * 2) * 0.08);
    }
  });

  const tone = job.priority === "critical" ? "#ff4e4e" : job.priority === "priority" ? "#ffb454" : "#6fe78b";

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
        <div className="world-tag world-tag-job">
          <p>{job.title}</p>
          <span>{`${routing.label} | ${job.status.replace(/_/g, " ")}`}</span>
        </div>
      </Html>
    </group>
  );
}
