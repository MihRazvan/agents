import { useEffect, useMemo, useRef, useState } from "react";
import { Bloom, EffectComposer, Noise, Vignette } from "@react-three/postprocessing";
import { Float, Line, OrbitControls, Sky, Stars, Text } from "@react-three/drei";
import { Canvas, type ThreeElements, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { AGENT_COLORS, type AgentRuntimeState, type Incident, type WorldSnapshot } from "@trust-city/shared";

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

function toWorldPoint(position: { x: number; y: number }): [number, number, number] {
  return [position.x, 0.72, position.y];
}

function toPathPoint(position: { x: number; y: number }): [number, number, number] {
  return [position.x, 0.35, position.y];
}

function BuildingBlock({ building }: { building: Building }) {
  const color = new THREE.Color(`hsl(${building.hue}, 42%, 20%)`);
  const emissive = new THREE.Color(`hsl(${building.hue}, 100%, 25%)`);

  return (
    <mesh position={[building.x, building.height / 2, building.z]} castShadow receiveShadow>
      <boxGeometry args={[building.width, building.height, building.depth]} />
      <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={0.2} metalness={0.45} roughness={0.45} />
    </mesh>
  );
}

function AgentAvatar({ agent }: { agent: AgentRuntimeState }) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    if (!groupRef.current) {
      return;
    }
    groupRef.current.position.y = 0.72 + Math.sin(clock.getElapsedTime() * 4 + agent.position.x) * 0.05;
  });

  const [x, y, z] = toWorldPoint(agent.position);
  const color = AGENT_COLORS[agent.role];

  return (
    <group ref={groupRef} position={[x, y, z]}>
      <mesh castShadow>
        <capsuleGeometry args={[0.24, 0.45, 4, 12]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.7} metalness={0.25} roughness={0.2} />
      </mesh>
      <mesh position={[0, 0.6, 0]} castShadow>
        <coneGeometry args={[0.18, 0.25, 12]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.95} metalness={0.15} roughness={0.1} />
      </mesh>
      <Text position={[0, 1.08, 0]} fontSize={0.16} color="#e8f1ff" anchorX="center" anchorY="bottom" maxWidth={4}>
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
      ringRef.current.rotation.z += 0.01;
      ringRef.current.scale.setScalar(1.15 + Math.sin(clock.getElapsedTime() * 2) * 0.08);
    }
  });

  const tone = incident.severity === "high" ? "#ff4e4e" : incident.severity === "medium" ? "#ffb454" : "#6fe78b";

  return (
    <group position={[x, y, z]}>
      <Float speed={2.1} rotationIntensity={0.2} floatIntensity={0.12}>
        <mesh ref={meshRef} castShadow>
          <octahedronGeometry args={[0.37, 0]} />
          <meshStandardMaterial color={tone} emissive={tone} emissiveIntensity={1.5} metalness={0.1} roughness={0.25} />
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
            <meshStandardMaterial color="#49d3ff" emissive="#49d3ff" emissiveIntensity={1.6} />
          </mesh>
        );
      })}
      {Array.from({ length: 9 }).map((_, index) => {
        const x = -16 + index * 4;
        return (
          <mesh key={`v-${index}`} position={[x, 0.02, 2.5]}>
            <boxGeometry args={[0.16, 0.04, 24]} />
            <meshStandardMaterial color="#8f7cff" emissive="#8f7cff" emissiveIntensity={1.1} />
          </mesh>
        );
      })}
    </group>
  );
}

export default function WorldScene({ snapshot }: Props) {
  const buildings = useMemo<Building[]>(() => {
    const list: Building[] = [];
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

  const [trailMap, setTrailMap] = useState<Record<string, Array<[number, number, number]>>>({});

  useEffect(() => {
    if (!snapshot) {
      return;
    }

    setTrailMap((current) => {
      const next: Record<string, Array<[number, number, number]>> = { ...current };
      for (const agent of snapshot.agents) {
        const agentTrail = [...(next[agent.id] ?? []), toPathPoint(agent.position)];
        next[agent.id] = agentTrail.slice(-40);
      }
      return next;
    });
  }, [snapshot]);

  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      camera={{ position: [18, 18, 21], fov: 46 }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
    >
      <color attach="background" args={["#080b15"]} />
      <fog attach="fog" args={["#080b15", 20, 58]} />

      <ambientLight intensity={0.4} color="#8ea9ff" />
      <directionalLight
        position={[14, 24, 10]}
        intensity={1.4}
        color="#d3e3ff"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <spotLight position={[-14, 18, -8]} intensity={120} distance={80} angle={0.33} penumbra={0.7} color="#4ad8ff" />

      <Sky distance={1200} sunPosition={[110, 40, 70]} turbidity={8} rayleigh={0.4} mieCoefficient={0.004} mieDirectionalG={0.9} />
      <Stars radius={120} depth={70} count={4000} factor={4.5} fade saturation={0} speed={1.2} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[80, 80, 1, 1]} />
        <meshStandardMaterial color="#0b1320" metalness={0.6} roughness={0.45} />
      </mesh>

      <NeonRoads />

      {buildings.map((building) => (
        <BuildingBlock key={`${building.x}-${building.z}`} building={building} />
      ))}

      {(snapshot?.incidents ?? [])
        .filter((incident) => incident.status === "open" || incident.status === "in_progress")
        .map((incident) => (
          <IncidentBeacon key={incident.id} incident={incident} />
        ))}

      {(snapshot?.agents ?? []).map((agent) => (
        <AgentAvatar key={agent.id} agent={agent} />
      ))}

      {Object.entries(trailMap).map(([agentId, points]) => {
        if (points.length < 2) {
          return null;
        }
        const agent = snapshot?.agents.find((candidate) => candidate.id === agentId);
        const color = agent ? AGENT_COLORS[agent.role] : "#9ecbff";
        return <Line key={agentId} points={points} color={color} lineWidth={1.6} transparent opacity={0.45} />;
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

      <OrbitControls makeDefault maxDistance={46} minDistance={13} target={[0, 1, 2]} maxPolarAngle={Math.PI / 2.1} />

      <EffectComposer>
        <Bloom intensity={1.15} luminanceThreshold={0.2} luminanceSmoothing={0.6} mipmapBlur />
        <Noise opacity={0.035} />
        <Vignette offset={0.16} darkness={0.62} eskil={false} />
      </EffectComposer>
    </Canvas>
  );
}
