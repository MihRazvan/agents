import { useMemo, useRef } from "react";
import { Float, Html, Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { AGENT_COLORS, DISTRICT_THEME_PURPOSE, JOB_ROUTING, ROLE_HUBS, type Job, type PluginAgentRecord, type Vec2, type WorldSnapshot } from "@trust-city/shared";
import { ROAD_MINOR_SPACING, type CityStructure, type RoadLine } from "./generator";

const WORLD_TAG_Z_INDEX_RANGE: [number, number] = [40, 0];

function toWorldPoint(position: Vec2, y = 0.72): [number, number, number] {
  return [position.x, y, position.y];
}

function glowMaterial(color: THREE.ColorRepresentation, intensity: number, opacity = 1) {
  return <meshStandardMaterial color={color} emissive={color} emissiveIntensity={intensity} transparent={opacity < 1} opacity={opacity} />;
}

export function StructureBlock({ structure }: { structure: CityStructure }) {
  const saturation = structure.kind === "park" || structure.kind === "tree" ? 38 : structure.lod === "near" ? 36 : 26;
  const lightness = structure.kind === "park" || structure.kind === "tree" ? 22 : structure.lod === "near" ? 16 : 11;
  const color = new THREE.Color(`hsl(${structure.hue}, ${saturation}%, ${lightness}%)`);
  const emissive = new THREE.Color(`hsl(${structure.hue}, ${structure.kind === "park" || structure.kind === "tree" ? 24 : 82}%, ${structure.lod === "near" ? 24 : 14}%)`);
  const accent = new THREE.Color(`hsl(${structure.hue}, 92%, 72%)`);

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
        <mesh position={[0, 0.03, 0]} receiveShadow>
          <boxGeometry args={[structure.width * 1.14, 0.06, structure.depth * 1.14]} />
          <meshStandardMaterial color="#151d28" roughness={0.95} />
        </mesh>
        <mesh position={[0, structure.height * 0.42, 0]} castShadow={structure.lod === "near"} receiveShadow>
          <boxGeometry args={[structure.width, structure.height * 0.84, structure.depth]} />
          <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={0.22} roughness={0.56} metalness={0.12} />
        </mesh>
        {structure.lod === "near" ? (
          <>
            <mesh position={[0, structure.height * 0.95, 0]} castShadow>
              <coneGeometry args={[Math.max(structure.width, structure.depth) * 0.58, structure.height * 0.38, 4]} />
              <meshStandardMaterial color="#59383a" emissive="#59383a" emissiveIntensity={0.18} roughness={0.72} />
            </mesh>
            <mesh position={[0, structure.height * 0.54, structure.depth * 0.51]}>
              <boxGeometry args={[structure.width * 0.34, structure.height * 0.18, 0.05]} />
              {glowMaterial("#ffd9a6", 0.8, 0.88)}
            </mesh>
          </>
        ) : null}
      </group>
    );
  }

  if (structure.kind === "institution") {
    return (
      <group position={[structure.x, 0, structure.z]}>
        <mesh position={[0, 0.04, 0]} receiveShadow>
          <boxGeometry args={[structure.width * 1.08, 0.08, structure.depth * 1.08]} />
          <meshStandardMaterial color="#111b27" roughness={0.92} metalness={0.08} />
        </mesh>
        <mesh position={[0, structure.height / 2, 0]} castShadow={structure.lod === "near"} receiveShadow>
          <boxGeometry args={[structure.width, structure.height, structure.depth]} />
          <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={0.28} metalness={0.3} roughness={0.44} />
        </mesh>
        {structure.lod === "near" ? (
          <>
            <mesh position={[0, structure.height + 0.32, 0]} castShadow>
              <sphereGeometry args={[Math.min(structure.width, structure.depth) * 0.2, 10, 8]} />
              <meshStandardMaterial color="#9ed7ff" emissive="#9ed7ff" emissiveIntensity={0.6} roughness={0.25} metalness={0.45} />
            </mesh>
            <mesh position={[0, 0.24, 0]}>
              <boxGeometry args={[structure.width * 0.94, 0.06, structure.depth * 0.94]} />
              {glowMaterial(accent, 0.38, 0.5)}
            </mesh>
          </>
        ) : null}
      </group>
    );
  }

  if (structure.kind === "warehouse") {
    return (
      <group position={[structure.x, 0, structure.z]}>
        <mesh position={[0, 0.03, 0]} receiveShadow>
          <boxGeometry args={[structure.width * 1.08, 0.06, structure.depth * 1.08]} />
          <meshStandardMaterial color="#10161f" roughness={0.96} />
        </mesh>
        <mesh position={[0, structure.height * 0.5, 0]} castShadow={structure.lod === "near"} receiveShadow>
          <boxGeometry args={[structure.width, structure.height, structure.depth]} />
          <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={0.18} metalness={0.2} roughness={0.68} />
        </mesh>
        {structure.lod === "near" ? (
          <>
            <mesh position={[structure.width * 0.2, structure.height + 0.12, 0]}>
              <boxGeometry args={[structure.width * 0.5, 0.08, structure.depth * 0.24]} />
              <meshStandardMaterial color="#5f6a73" roughness={0.72} metalness={0.14} />
            </mesh>
            <mesh position={[0, structure.height * 0.62, structure.depth * 0.52]}>
              <boxGeometry args={[structure.width * 0.76, 0.08, 0.05]} />
              {glowMaterial("#ffcb8d", 0.55, 0.72)}
            </mesh>
          </>
        ) : null}
      </group>
    );
  }

  if (structure.kind === "midrise") {
    return (
      <group position={[structure.x, 0, structure.z]}>
        <mesh position={[0, 0.05, 0]} receiveShadow>
          <boxGeometry args={[structure.width * 1.08, 0.1, structure.depth * 1.08]} />
          <meshStandardMaterial color="#121a26" roughness={0.94} metalness={0.08} />
        </mesh>
        <mesh position={[0, structure.height * 0.46, 0]} castShadow={structure.lod === "near"} receiveShadow>
          <boxGeometry args={[structure.width, structure.height * 0.92, structure.depth]} />
          <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={0.24} metalness={0.22} roughness={0.54} />
        </mesh>
        {structure.lod === "near" ? (
          <>
            <mesh position={[0, structure.height * 0.96, 0]}>
              <boxGeometry args={[structure.width * 0.74, structure.height * 0.18, structure.depth * 0.74]} />
              <meshStandardMaterial color={color.clone().offsetHSL(0, -0.04, 0.04)} emissive={emissive} emissiveIntensity={0.26} metalness={0.28} roughness={0.4} />
            </mesh>
            <mesh position={[0, structure.height * 0.58, structure.depth * 0.5]}>
              <boxGeometry args={[structure.width * 0.72, structure.height * 0.48, 0.04]} />
              {glowMaterial("#9fd7ff", 0.32, 0.24)}
            </mesh>
            <mesh position={[0, structure.height * 0.58, -structure.depth * 0.5]}>
              <boxGeometry args={[structure.width * 0.72, structure.height * 0.48, 0.04]} />
              {glowMaterial("#9fd7ff", 0.32, 0.18)}
            </mesh>
          </>
        ) : null}
      </group>
    );
  }

  return (
    <group position={[structure.x, 0, structure.z]}>
      <mesh position={[0, 0.06, 0]} receiveShadow>
        <boxGeometry args={[structure.width * 1.1, 0.12, structure.depth * 1.1]} />
        <meshStandardMaterial color="#121a26" roughness={0.94} metalness={0.08} />
      </mesh>
      <mesh position={[0, structure.height / 2, 0]} castShadow={structure.lod === "near"} receiveShadow>
        <boxGeometry args={[structure.width, structure.height, structure.depth]} />
        <meshStandardMaterial
          color={color}
          emissive={emissive}
          emissiveIntensity={structure.kind === "tower" ? 0.36 : 0.2}
          metalness={structure.kind === "tower" ? 0.45 : 0.25}
          roughness={structure.kind === "tower" ? 0.36 : 0.56}
        />
      </mesh>
      {structure.kind === "tower" && structure.lod === "near" ? (
        <>
          <mesh position={[0, structure.height * 0.82, 0]}>
            <boxGeometry args={[structure.width * 0.84, structure.height * 0.24, structure.depth * 0.84]} />
            <meshStandardMaterial color={color.clone().offsetHSL(0, -0.03, 0.05)} emissive={emissive} emissiveIntensity={0.3} metalness={0.38} roughness={0.28} />
          </mesh>
          <mesh position={[0, structure.height + 0.4, 0]}>
            <boxGeometry args={[structure.width * 0.42, 0.18, structure.depth * 0.42]} />
            {glowMaterial(accent, 1.05, 0.94)}
          </mesh>
          <mesh position={[0, structure.height * 0.66, structure.depth * 0.5]}>
            <boxGeometry args={[structure.width * 0.64, structure.height * 0.48, 0.04]} />
            {glowMaterial("#9ed8ff", 0.5, 0.42)}
          </mesh>
          <mesh position={[0, structure.height * 0.66, -structure.depth * 0.5]}>
            <boxGeometry args={[structure.width * 0.64, structure.height * 0.48, 0.04]} />
            {glowMaterial("#ffcf9b", 0.34, 0.18)}
          </mesh>
        </>
      ) : null}
    </group>
  );
}

export function DynamicRoads({ roads }: { roads: RoadLine[] }) {
  return (
    <group>
      {roads.map((road) => {
        const color = road.kind === "major" ? "#262c33" : "#1b2026";
        const markerColor = road.kind === "major" ? "#7d7364" : "#3f4650";

        return (
          <group key={`${road.axis}-${road.x}-${road.z}`} position={[road.x, 0.02, road.z]}>
            <mesh>
              <boxGeometry args={road.axis === "h" ? [road.length, 0.04, road.width] : [road.width, 0.04, road.length]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={road.kind === "major" ? 0.12 : 0.04} roughness={0.96} />
            </mesh>
            <mesh position={[0, 0.025, 0]}>
              <boxGeometry args={road.axis === "h" ? [road.length, 0.008, 0.06] : [0.06, 0.008, road.length]} />
              <meshStandardMaterial color={markerColor} emissive={markerColor} emissiveIntensity={road.kind === "major" ? 0.08 : 0.02} transparent opacity={road.kind === "major" ? 0.42 : 0.18} />
            </mesh>
            <mesh position={[0, 0.015, road.axis === "h" ? road.width * 0.5 - 0.18 : 0]} rotation={road.axis === "h" ? [0, 0, 0] : [0, Math.PI / 2, 0]}>
              <boxGeometry args={[road.axis === "h" ? road.length : road.length, 0.01, 0.04]} />
              <meshStandardMaterial color="#2d3742" emissive="#2d3742" emissiveIntensity={0.04} transparent opacity={0.45} />
            </mesh>
            <mesh position={[0, 0.015, road.axis === "h" ? -road.width * 0.5 + 0.18 : 0]} rotation={road.axis === "h" ? [0, 0, 0] : [0, Math.PI / 2, 0]}>
              <boxGeometry args={[road.axis === "h" ? road.length : road.length, 0.01, 0.04]} />
              <meshStandardMaterial color="#2d3742" emissive="#2d3742" emissiveIntensity={0.04} transparent opacity={0.45} />
            </mesh>
          </group>
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
        const paving = district.theme === "core" ? "#101a28" : district.theme === "industrial" ? "#181714" : district.theme === "research" ? "#101423" : "#111b16";
        const isSelectedHome = selectedAgent?.homeDistrictId === district.id;
        return (
          <group key={district.id} position={[district.center.x, 0, district.center.y]}>
            <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[district.radius - 0.8, 48]} />
              <meshStandardMaterial color={paving} emissive={paving} emissiveIntensity={0.08} roughness={0.98} metalness={0.04} transparent opacity={0.86} />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[district.radius - 0.34, district.radius, 64]} />
              <meshStandardMaterial color={hue} emissive={hue} emissiveIntensity={0.18} transparent opacity={isSelectedHome ? 0.26 : 0.08} />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
              <ringGeometry args={[district.radius * 0.42, district.radius * 0.44, 48]} />
              <meshStandardMaterial color={hue} emissive={hue} emissiveIntensity={0.22} transparent opacity={isSelectedHome ? 0.16 : 0.05} />
            </mesh>
            <Html position={[0, 0.24, district.radius + 0.86]} center zIndexRange={WORLD_TAG_Z_INDEX_RANGE}>
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

function HubGround({ role, color }: { role: keyof typeof ROLE_HUBS; color: string }) {
  if (role === "scout") {
    return (
      <group>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]}>
          <circleGeometry args={[3.4, 32]} />
          <meshStandardMaterial color="#101a25" roughness={0.98} />
        </mesh>
        <mesh position={[0, 0.03, 1.8]}>
          <boxGeometry args={[2.2, 0.06, 4.8]} />
          <meshStandardMaterial color="#122332" emissive="#19384d" emissiveIntensity={0.12} roughness={0.92} />
        </mesh>
      </group>
    );
  }

  if (role === "planner") {
    return (
      <group>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
          <circleGeometry args={[3.8, 40]} />
          <meshStandardMaterial color="#171d27" roughness={0.97} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
          <ringGeometry args={[1.5, 1.7, 32]} />
          <meshStandardMaterial color="#4d4a40" emissive="#4d4a40" emissiveIntensity={0.08} transparent opacity={0.72} />
        </mesh>
      </group>
    );
  }

  if (role === "builder") {
    return (
      <group>
        <mesh position={[0, 0.03, 0]}>
          <boxGeometry args={[4.8, 0.08, 4.2]} />
          <meshStandardMaterial color="#141a14" roughness={0.95} />
        </mesh>
        {[-1.2, 0, 1.2].map((x) => (
          <mesh key={x} position={[x, 0.09, -1.2]}>
            <boxGeometry args={[0.56, 0.18, 0.56]} />
            <meshStandardMaterial color="#3d4a36" emissive="#516843" emissiveIntensity={0.14} roughness={0.8} />
          </mesh>
        ))}
      </group>
    );
  }

  if (role === "verifier") {
    return (
      <group>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
          <circleGeometry args={[3.2, 32]} />
          <meshStandardMaterial color="#1a171c" roughness={0.97} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
          <ringGeometry args={[1.8, 2.04, 36]} />
          <meshStandardMaterial color="#5f4949" emissive="#5f4949" emissiveIntensity={0.08} transparent opacity={0.6} />
        </mesh>
      </group>
    );
  }

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <circleGeometry args={[3.4, 36]} />
        <meshStandardMaterial color="#171325" roughness={0.97} />
      </mesh>
      <mesh position={[0, 0.03, -1.4]}>
        <boxGeometry args={[1.4, 0.08, 2.8]} />
        <meshStandardMaterial color="#21193a" emissive="#352864" emissiveIntensity={0.12} roughness={0.88} />
      </mesh>
    </group>
  );
}

function HubMonument({ role, color }: { role: keyof typeof ROLE_HUBS; color: string }) {
  if (role === "scout") {
    return (
      <group>
        <mesh position={[0, 0.4, 0]}>
          <cylinderGeometry args={[0.26, 0.42, 0.8, 10]} />
          <meshStandardMaterial color="#10283e" emissive="#16486f" emissiveIntensity={0.42} metalness={0.32} roughness={0.36} />
        </mesh>
        <mesh position={[0, 1.12, 0]}>
          <sphereGeometry args={[0.28, 14, 12]} />
          {glowMaterial(color, 1.1, 0.9)}
        </mesh>
        <mesh position={[0, 1.5, 0]}>
          <cylinderGeometry args={[0.03, 0.05, 0.52, 8]} />
          {glowMaterial("#dff7ff", 1.2, 0.95)}
        </mesh>
      </group>
    );
  }

  if (role === "planner") {
    return (
      <group>
        <mesh position={[0, 0.22, 0]}>
          <cylinderGeometry args={[0.84, 0.92, 0.28, 24]} />
          <meshStandardMaterial color="#1b2430" emissive="#2a394a" emissiveIntensity={0.26} metalness={0.2} roughness={0.44} />
        </mesh>
        <mesh position={[0, 0.74, 0]}>
          <sphereGeometry args={[0.46, 18, 14]} />
          {glowMaterial("#ffd787", 0.9, 0.88)}
        </mesh>
        <mesh position={[0, 1.1, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.72, 0.04, 8, 32]} />
          {glowMaterial(color, 0.8, 0.72)}
        </mesh>
      </group>
    );
  }

  if (role === "builder") {
    return (
      <group>
        <mesh position={[0, 0.42, 0]}>
          <boxGeometry args={[0.34, 0.84, 0.34]} />
          <meshStandardMaterial color="#1d2a24" emissive="#215034" emissiveIntensity={0.32} metalness={0.28} roughness={0.38} />
        </mesh>
        <mesh position={[0.44, 0.86, 0]} rotation={[0, 0, Math.PI / 8]}>
          <boxGeometry args={[0.12, 1.54, 0.12]} />
          {glowMaterial(color, 0.9, 0.86)}
        </mesh>
        <mesh position={[0.78, 1.42, 0]}>
          <boxGeometry args={[0.74, 0.08, 0.08]} />
          {glowMaterial("#ecffc7", 1.1, 0.86)}
        </mesh>
      </group>
    );
  }

  if (role === "verifier") {
    return (
      <group>
        <mesh position={[0, 0.62, 0]}>
          <octahedronGeometry args={[0.54, 0]} />
          {glowMaterial(color, 1.2, 0.94)}
        </mesh>
        <mesh position={[0, 0.2, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.9, 0.04, 8, 36]} />
          {glowMaterial("#ffc2c2", 0.8, 0.72)}
        </mesh>
      </group>
    );
  }

  return (
    <group>
      <mesh position={[0, 0.9, 0]}>
        <cylinderGeometry args={[0.2, 0.34, 1.8, 12]} />
        <meshStandardMaterial color="#24193a" emissive="#3b2870" emissiveIntensity={0.36} metalness={0.28} roughness={0.3} />
      </mesh>
      <mesh position={[0, 1.92, 0]}>
        <coneGeometry args={[0.34, 0.64, 6]} />
        {glowMaterial(color, 1.15, 0.9)}
      </mesh>
      <mesh position={[0, 0.72, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.54, 0.05, 8, 28]} />
        {glowMaterial("#f0c6ff", 0.82, 0.72)}
      </mesh>
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
            <HubGround role={role as keyof typeof ROLE_HUBS} color={color} />
            <HubMonument role={role as keyof typeof ROLE_HUBS} color={color} />
            <Html position={[0, 1.08, 0]} center zIndexRange={WORLD_TAG_Z_INDEX_RANGE}>
              <div className="world-tag world-tag-hub">
                <p>{hub.name}</p>
              </div>
            </Html>
          </group>
        );
      })}
      {spinePoints.length > 1 ? <Line points={spinePoints} color="#6dc8ff" lineWidth={2.2} transparent opacity={0.58} /> : null}
      <Html position={[24, 0.32, -18]} center zIndexRange={WORLD_TAG_Z_INDEX_RANGE}>
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
      <Html position={[0, 1.68, 0]} center zIndexRange={WORLD_TAG_Z_INDEX_RANGE}>
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
  const meshRef = useRef<THREE.Group>(null);

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
    <group ref={meshRef}>
      <mesh>
        <boxGeometry args={[0.28, 0.12, 0.16]} />
        <meshStandardMaterial color={props.color} emissive={props.color} emissiveIntensity={0.75} metalness={0.24} roughness={0.25} />
      </mesh>
      <mesh position={[0, 0, -0.16]}>
        <boxGeometry args={[0.16, 0.04, 0.28]} />
        {glowMaterial(props.color, 1.2, 0.42)}
      </mesh>
    </group>
  );
}

export function JobBeacon({ job }: { job: Job }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const haloRef = useRef<THREE.Mesh>(null);
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
    if (haloRef.current) {
      haloRef.current.scale.setScalar(1.25 + Math.sin(clock.getElapsedTime() * 1.6) * 0.12);
    }
  });

  const tone = job.priority === "critical" ? "#ff4e4e" : job.priority === "priority" ? "#ffb454" : "#6fe78b";

  return (
    <group position={[x, y, z]}>
      <mesh ref={haloRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.52, 0]}>
        <ringGeometry args={[1.14, 1.46, 36]} />
        {glowMaterial(tone, 0.8, 0.22)}
      </mesh>
      <mesh position={[0, 0.55, 0]}>
        <cylinderGeometry args={[0.14, 0.22, 1.8, 10, 1, true]} />
        {glowMaterial(tone, 1.1, 0.22)}
      </mesh>
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
      <Html position={[0, 1.05, 0]} center zIndexRange={WORLD_TAG_Z_INDEX_RANGE}>
        <div className="world-tag world-tag-job">
          <p>{job.title}</p>
          <span>{`${routing.label} | ${job.status.replace(/_/g, " ")}`}</span>
        </div>
      </Html>
    </group>
  );
}
