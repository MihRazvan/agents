import { Suspense, useEffect, useMemo, useRef, useState, type MutableRefObject, type RefObject } from "react";
import { Bloom, EffectComposer, Noise, Vignette } from "@react-three/postprocessing";
import { Line, OrbitControls, Sky, Stars, Text } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import * as THREE from "three";
import { AGENT_COLORS, type Incident, type Vec2, type WorldSnapshot } from "@trust-city/shared";
import { buildStreamedCity, CHUNK_SIZE } from "../city/generator";
import { DistrictOverlay, DynamicRoads, IncidentBeacon, RoleHubLandmarks, StructureBlock, TrafficLanes } from "../city/layers";
import AnimatedAgentAvatar from "./AnimatedAgentAvatar";

interface Props {
  snapshot: WorldSnapshot | null;
}

const USER_CONTROL_PAUSE_MS = 9000;

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
