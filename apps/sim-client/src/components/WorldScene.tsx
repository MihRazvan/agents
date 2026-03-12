import { useEffect, useMemo, useRef, useState } from "react";
import { Bloom, EffectComposer, Noise, Vignette } from "@react-three/postprocessing";
import { Float, Line, OrbitControls, Sky, Stars, Text } from "@react-three/drei";
import { Canvas, type ThreeElements, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { AGENT_COLORS, type AgentRuntimeState, type Incident, type Vec2, type WorldSnapshot } from "@trust-city/shared";

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
}

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

function BuildingBlock({ building }: { building: Building }) {
  const color = new THREE.Color(`hsl(${building.hue}, 45%, 17%)`);
  const emissive = new THREE.Color(`hsl(${building.hue}, 100%, 24%)`);

  return (
    <mesh position={[building.x, building.height / 2, building.z]} castShadow receiveShadow>
      <boxGeometry args={[building.width, building.height, building.depth]} />
      <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={0.25} metalness={0.5} roughness={0.4} />
    </mesh>
  );
}

function DistrictOverlay({ snapshot }: { snapshot: WorldSnapshot }) {
  return (
    <group>
      {snapshot.districts.map((district) => {
        const hue = district.theme === "core" ? "#59e4ff" : district.theme === "industrial" ? "#ff8f66" : district.theme === "research" ? "#89a0ff" : "#89ffb3";
        return (
          <group key={district.id} position={[district.center.x, 0, district.center.y]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[district.radius - 0.14, district.radius, 64]} />
              <meshStandardMaterial color={hue} emissive={hue} emissiveIntensity={0.65} transparent opacity={0.25} />
            </mesh>
            <Text position={[0, 0.1, district.radius + 0.55]} fontSize={0.18} color="#daf3ff" anchorX="center" anchorY="middle">
              {district.name}
            </Text>
          </group>
        );
      })}
    </group>
  );
}

function TrafficLanes() {
  const movers = useMemo(() => {
    return Array.from({ length: 26 }).map((_, index) => ({
      id: index,
      lane: (index % 2 === 0 ? "h" : "v") as "h" | "v",
      offset: index * 1.3,
      speed: 0.5 + (index % 7) * 0.06,
      span: 34,
      color: index % 3 === 0 ? "#67dfff" : index % 3 === 1 ? "#ba9cff" : "#94ff7b"
    }));
  }, []);

  return (
    <group>
      {movers.map((mover) => (
        <TrafficNode key={mover.id} {...mover} />
      ))}
    </group>
  );
}

function TrafficNode(props: { lane: "h" | "v"; offset: number; speed: number; span: number; color: string }) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (!meshRef.current) {
      return;
    }
    const t = clock.getElapsedTime() * props.speed + props.offset;
    const oscillation = ((t % props.span) / props.span) * 2 - 1;

    if (props.lane === "h") {
      meshRef.current.position.set(oscillation * 16, 0.12, -8 + Math.sin(props.offset) * 9);
    } else {
      meshRef.current.position.set(-14 + Math.cos(props.offset * 0.75) * 11, 0.12, oscillation * 12);
    }
  });

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[0.09, 10, 10]} />
      <meshStandardMaterial color={props.color} emissive={props.color} emissiveIntensity={1.6} metalness={0.15} roughness={0.12} />
    </mesh>
  );
}

function AgentAvatar({ agent, incident }: { agent: AgentRuntimeState; incident?: Incident }) {
  const groupRef = useRef<THREE.Group>(null);
  const leftArmRef = useRef<THREE.Mesh>(null);
  const rightArmRef = useRef<THREE.Mesh>(null);
  const leftLegRef = useRef<THREE.Mesh>(null);
  const rightLegRef = useRef<THREE.Mesh>(null);
  const auraRef = useRef<THREE.Mesh>(null);

  const [x, y, z] = toWorldPoint(agent.position);
  const color = AGENT_COLORS[agent.role];
  const moving = agent.path.length > 0;
  const phaseIntensity =
    agent.phase === "execute"
      ? 1.1
      : agent.phase === "verify"
        ? 0.92
        : agent.phase === "plan"
          ? 0.75
          : agent.phase === "submit"
            ? 0.85
            : 0.55;

  useFrame(({ clock }, delta) => {
    if (!groupRef.current) {
      return;
    }

    const beat = clock.getElapsedTime() * (moving ? 9.5 : 4) * phaseIntensity;
    const swing = moving ? 0.58 : 0.12;

    if (leftArmRef.current && rightArmRef.current && leftLegRef.current && rightLegRef.current) {
      leftArmRef.current.rotation.x = Math.sin(beat) * swing;
      rightArmRef.current.rotation.x = Math.sin(beat + Math.PI) * swing;
      leftLegRef.current.rotation.x = Math.sin(beat + Math.PI) * swing * 0.78;
      rightLegRef.current.rotation.x = Math.sin(beat) * swing * 0.78;
    }

    if (auraRef.current) {
      const pulse = 0.86 + Math.sin(clock.getElapsedTime() * (2.4 + phaseIntensity)) * 0.12;
      auraRef.current.scale.set(pulse + agent.trustScore * 0.5, pulse + agent.trustScore * 0.5, 1);
    }

    const targetYaw = Math.atan2(agent.target.x - agent.position.x, agent.target.y - agent.position.y);
    groupRef.current.rotation.y = THREE.MathUtils.damp(groupRef.current.rotation.y, targetYaw, 7, delta);
    groupRef.current.position.y = y + Math.sin(clock.getElapsedTime() * 4.6 + agent.position.x) * 0.03;
  });

  return (
    <group ref={groupRef} position={[x, y, z]}>
      <mesh ref={auraRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.58, 0]}>
        <ringGeometry args={[0.42, 0.54, 32]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.25} transparent opacity={0.35 + agent.trustScore * 0.2} />
      </mesh>

      <mesh castShadow>
        <capsuleGeometry args={[0.24, 0.45, 4, 12]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.72} metalness={0.2} roughness={0.2} />
      </mesh>

      <mesh position={[0, 0.55, 0]} castShadow>
        <sphereGeometry args={[0.18, 16, 16]} />
        <meshStandardMaterial color="#dfe8ff" emissive={color} emissiveIntensity={0.35} metalness={0.1} roughness={0.2} />
      </mesh>

      <mesh ref={leftArmRef} position={[-0.28, 0.15, 0]} castShadow>
        <capsuleGeometry args={[0.06, 0.28, 4, 8]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.42} />
      </mesh>
      <mesh ref={rightArmRef} position={[0.28, 0.15, 0]} castShadow>
        <capsuleGeometry args={[0.06, 0.28, 4, 8]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.42} />
      </mesh>

      <mesh ref={leftLegRef} position={[-0.11, -0.38, 0]} castShadow>
        <capsuleGeometry args={[0.065, 0.3, 4, 8]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.28} />
      </mesh>
      <mesh ref={rightLegRef} position={[0.11, -0.38, 0]} castShadow>
        <capsuleGeometry args={[0.065, 0.3, 4, 8]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.28} />
      </mesh>

      {incident ? (
        <Line
          points={[
            [0, 0.32, 0],
            [incident.position.x - agent.position.x, 0.3, incident.position.y - agent.position.y]
          ]}
          color={color}
          dashed
          dashScale={2}
          dashSize={0.4}
          gapSize={0.22}
          transparent
          opacity={0.5}
          lineWidth={1.2}
        />
      ) : null}

      <Text position={[0, 1.02, 0]} fontSize={0.15} color="#e8f1ff" anchorX="center" anchorY="bottom" maxWidth={4}>
        {agent.name}
      </Text>
    </group>
  );
}

function IncidentBeacon({ incident }: { incident: Incident }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const [x, y, z] = toWorldPoint(incident.position);

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
        {incident.category}
      </Text>
    </group>
  );
}

function NeonRoads(props: ThreeElements["group"]) {
  return (
    <group {...props}>
      {Array.from({ length: 7 }).map((_, index) => {
        const z = -10 + index * 4;
        return (
          <mesh key={`h-${index}`} position={[0, 0.02, z]}>
            <boxGeometry args={[34, 0.04, 0.16]} />
            <meshStandardMaterial color="#49d3ff" emissive="#49d3ff" emissiveIntensity={1.55} />
          </mesh>
        );
      })}
      {Array.from({ length: 9 }).map((_, index) => {
        const x = -16 + index * 4;
        return (
          <mesh key={`v-${index}`} position={[x, 0.02, 2.5]}>
            <boxGeometry args={[0.16, 0.04, 24]} />
            <meshStandardMaterial color="#8f7cff" emissive="#8f7cff" emissiveIntensity={1.15} />
          </mesh>
        );
      })}
    </group>
  );
}

function CameraDirector({ snapshot }: { snapshot: WorldSnapshot | null }) {
  const { camera } = useThree();
  const focusRef = useRef(new THREE.Vector3(0, 1.4, 0));
  const camPosRef = useRef(new THREE.Vector3(18, 18, 21));

  useFrame((state, delta) => {
    if (!snapshot) {
      return;
    }

    const activeIncidents = snapshot.incidents.filter((incident) => incident.status === "open" || incident.status === "in_progress");
    const focusIncident =
      activeIncidents.find((incident) => incident.id === snapshot.cinematicFocus) ??
      activeIncidents.sort((a, b) => severityRank(b.severity) - severityRank(a.severity))[0];

    const focus = focusIncident
      ? new THREE.Vector3(focusIncident.position.x, 1.5, focusIncident.position.y)
      : new THREE.Vector3(0, 1.2, 1);

    const orbit = state.clock.getElapsedTime() * 0.1;
    const desiredPosition = new THREE.Vector3(
      focus.x + Math.cos(orbit) * 14,
      11.5 + Math.sin(orbit * 1.7) * 1.2,
      focus.z + Math.sin(orbit) * 13
    );

    focusRef.current.lerp(focus, Math.min(1, delta * 2.4));
    camPosRef.current.lerp(desiredPosition, Math.min(1, delta * 1.6));

    camera.position.copy(camPosRef.current);
    camera.lookAt(focusRef.current);
  });

  return null;
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

export default function WorldScene({ snapshot }: Props) {
  const buildings = useMemo<Building[]>(() => {
    const list: Building[] = [];
    const seed = snapshot?.worldSeed ?? 271828;

    for (let gx = -4; gx <= 4; gx += 1) {
      for (let gz = -2; gz <= 4; gz += 1) {
        if (Math.abs(gx) <= 1 && Math.abs(gz - 1) <= 1) {
          continue;
        }

        const n = hashNumber(seed, gx, gz);
        const n2 = hashNumber(seed + 1, gz, gx);

        list.push({
          x: gx * 4 + (n - 0.5) * 0.45,
          z: gz * 4 + (n2 - 0.5) * 0.4,
          width: 1.3 + n * 0.75,
          depth: 1.3 + n2 * 0.68,
          height: 1.7 + (0.4 + n * 0.6 + n2 * 0.7) * 4.7,
          hue: 188 + Math.floor((n * 140) % 130)
        });
      }
    }

    return list;
  }, [snapshot?.worldSeed]);

  const [trailMap, setTrailMap] = useState<Record<string, Array<[number, number, number]>>>({});

  useEffect(() => {
    if (!snapshot) {
      return;
    }

    setTrailMap((current) => {
      const next: Record<string, Array<[number, number, number]>> = { ...current };
      for (const agent of snapshot.agents) {
        const agentTrail = [...(next[agent.id] ?? []), toPathPoint(agent.position)];
        next[agent.id] = agentTrail.slice(-54);
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
      dpr={[1, 1.9]}
      camera={{ position: [18, 18, 21], fov: 46 }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
    >
      <color attach="background" args={["#080b15"]} />
      <fog attach="fog" args={["#080b15", 20, 58]} />

      <ambientLight intensity={0.44} color="#8ea9ff" />
      <directionalLight
        position={[14, 24, 10]}
        intensity={1.42}
        color="#d3e3ff"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <spotLight position={[-14, 18, -8]} intensity={120} distance={80} angle={0.33} penumbra={0.7} color="#4ad8ff" />

      <Sky distance={1200} sunPosition={[110, 40, 70]} turbidity={8} rayleigh={0.4} mieCoefficient={0.004} mieDirectionalG={0.9} />
      <Stars radius={120} depth={70} count={4000} factor={4.4} fade saturation={0} speed={1.1} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[80, 80, 1, 1]} />
        <meshStandardMaterial color="#0b1320" metalness={0.6} roughness={0.45} />
      </mesh>

      <NeonRoads />
      <TrafficLanes />

      {snapshot ? <DistrictOverlay snapshot={snapshot} /> : null}

      {buildings.map((building) => (
        <BuildingBlock key={`${building.x}-${building.z}`} building={building} />
      ))}

      {(snapshot?.incidents ?? [])
        .filter((incident) => incident.status === "open" || incident.status === "in_progress")
        .map((incident) => (
          <IncidentBeacon key={incident.id} incident={incident} />
        ))}

      {(snapshot?.agents ?? []).map((agent) => (
        <AgentAvatar key={agent.id} agent={agent} incident={agent.assignedIncidentId ? incidentsById.get(agent.assignedIncidentId) : undefined} />
      ))}

      {Object.entries(trailMap).map(([agentId, points]) => {
        if (points.length < 2) {
          return null;
        }
        const agent = snapshot?.agents.find((candidate) => candidate.id === agentId);
        const color = agent ? AGENT_COLORS[agent.role] : "#9ecbff";
        return <Line key={agentId} points={points} color={color} lineWidth={1.55} transparent opacity={0.4} />;
      })}

      {(snapshot?.receipts ?? []).slice(-6).map((txHash, index) => (
        <group key={txHash} position={[18, 0.8 + index * 1.1, -8]}>
          <mesh>
            <torusGeometry args={[0.3, 0.08, 9, 22]} />
            <meshStandardMaterial color="#56ffd9" emissive="#56ffd9" emissiveIntensity={1.35} metalness={0.2} roughness={0.15} />
          </mesh>
          <Text position={[0.9, 0, 0]} fontSize={0.12} color="#d7fffa" anchorX="left" anchorY="middle">
            {txHash.slice(0, 10)}
          </Text>
        </group>
      ))}

      <CameraDirector snapshot={snapshot} />
      <OrbitControls maxDistance={46} minDistance={13} target={[0, 1, 2]} maxPolarAngle={Math.PI / 2.08} enablePan={false} />

      <EffectComposer>
        <Bloom intensity={1.2} luminanceThreshold={0.2} luminanceSmoothing={0.6} mipmapBlur />
        <Noise opacity={0.03} />
        <Vignette offset={0.15} darkness={0.62} eskil={false} />
      </EffectComposer>
    </Canvas>
  );
}
