import { Suspense, useEffect, useMemo, useRef, useState, type MutableRefObject, type RefObject } from "react";
import { Bloom, EffectComposer, Noise, Vignette } from "@react-three/postprocessing";
import { Line, OrbitControls, Sky, Stars, Text } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import * as THREE from "three";
import { AGENT_COLORS, type ChatMessage, type Job, type Vec2, type WorldSnapshot } from "@trust-city/shared";
import { buildStreamedCity, CHUNK_SIZE, type CityStructure } from "../city/generator";
import { DistrictOverlay, DynamicRoads, JobBeacon, PluginRegistryBoard, RoleHubLandmarks, StructureBlock, TrafficLanes } from "../city/layers";
import AnimatedAgentAvatar from "./AnimatedAgentAvatar";

interface Props {
  snapshot: WorldSnapshot | null;
  selectedAgentId?: string | null;
  followAgentId?: string | null;
  focusNonce?: number;
}

const USER_CONTROL_PAUSE_MS = 9000;
const ACTIVE_CHAT_MS = 9000;
const FOLLOW_CAMERA_DISTANCE = 13.5;
const FOLLOW_CAMERA_HEIGHT = 7.2;
const FOLLOW_CAMERA_SHOULDER = 3.4;
const FOLLOW_LOOK_AHEAD = 6.2;
const FOLLOW_LOOK_HEIGHT = 2.9;
const FOLLOW_TARGET_LAG = 5.4;
const FOLLOW_CAMERA_LAG = 2.2;
const FOLLOW_COLLISION_BUFFER = 2.2;
const FOLLOW_MIN_DISTANCE = 5.8;

function toPathPoint(position: Vec2): [number, number, number] {
  return [position.x, 0.35, position.y];
}

function priorityRank(priority: Job["priority"]): number {
  if (priority === "critical") {
    return 3;
  }
  if (priority === "priority") {
    return 2;
  }
  return 1;
}

function getFocusPoint(snapshot: WorldSnapshot | null, selectedAgentId?: string | null): Vec2 {
  if (!snapshot) {
    return { x: 0, y: 0 };
  }

  if (selectedAgentId) {
    const selectedAgent = snapshot.agents.find((agent) => agent.id === selectedAgentId);
    if (selectedAgent) {
      return selectedAgent.position;
    }
  }

  const activeJobs = snapshot.jobs.filter((job) => job.status !== "completed" && job.status !== "failed");
  const focusJob =
    activeJobs.find((job) => job.id === snapshot.cinematicFocus) ??
    activeJobs.sort((a, b) => priorityRank(b.priority) - priorityRank(a.priority))[0];

  if (focusJob) {
    return focusJob.position;
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

function agentLookVector(agent: WorldSnapshot["agents"][number]): THREE.Vector3 {
  const nextWaypoint = agent.path[0] ?? agent.target;
  const dx = nextWaypoint.x - agent.position.x;
  const dz = nextWaypoint.y - agent.position.y;
  const length = Math.hypot(dx, dz);
  if (length < 0.001) {
    return new THREE.Vector3(0.6, 0, 1).normalize();
  }
  return new THREE.Vector3(dx / length, 0, dz / length);
}

function getFollowCameraPosition(
  agent: WorldSnapshot["agents"][number],
  options?: {
    distance?: number;
    height?: number;
    shoulder?: number;
  }
): THREE.Vector3 {
  const forward = agentLookVector(agent);
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const behind = forward.clone().multiplyScalar(-(options?.distance ?? FOLLOW_CAMERA_DISTANCE));
  const shoulder = right.multiplyScalar(options?.shoulder ?? FOLLOW_CAMERA_SHOULDER);
  return new THREE.Vector3(agent.position.x + behind.x + shoulder.x, options?.height ?? FOLLOW_CAMERA_HEIGHT, agent.position.y + behind.z + shoulder.z);
}

function getFollowTargetPosition(agent: WorldSnapshot["agents"][number]): THREE.Vector3 {
  const forward = agentLookVector(agent);
  return new THREE.Vector3(
    agent.position.x + forward.x * FOLLOW_LOOK_AHEAD,
    FOLLOW_LOOK_HEIGHT,
    agent.position.y + forward.z * FOLLOW_LOOK_AHEAD
  );
}

function collidableStructures(structures: CityStructure[]): CityStructure[] {
  return structures.filter((structure) => structure.kind !== "park" && structure.kind !== "tree");
}

function structureBox(structure: CityStructure): THREE.Box3 {
  return new THREE.Box3(
    new THREE.Vector3(structure.x - structure.width / 2, 0, structure.z - structure.depth / 2),
    new THREE.Vector3(structure.x + structure.width / 2, structure.height, structure.z + structure.depth / 2)
  );
}

function resolveCameraObstruction(
  desiredCamera: THREE.Vector3,
  lookTarget: THREE.Vector3,
  structures: CityStructure[]
): THREE.Vector3 {
  const direction = desiredCamera.clone().sub(lookTarget);
  const distance = direction.length();
  if (distance < 0.001) {
    return desiredCamera;
  }

  const ray = new THREE.Ray(lookTarget.clone(), direction.clone().normalize());
  let nearestHit = distance;

  for (const structure of structures) {
    const hit = ray.intersectBox(structureBox(structure), new THREE.Vector3());
    if (!hit) {
      continue;
    }
    const hitDistance = hit.distanceTo(lookTarget);
    if (hitDistance < nearestHit) {
      nearestHit = hitDistance;
    }
  }

  if (nearestHit >= distance) {
    return desiredCamera;
  }

  const safeDistance = Math.max(FOLLOW_MIN_DISTANCE, nearestHit - FOLLOW_COLLISION_BUFFER);
  const adjusted = lookTarget.clone().add(direction.normalize().multiplyScalar(safeDistance));
  adjusted.y = Math.max(adjusted.y, FOLLOW_CAMERA_HEIGHT * 0.8);
  return adjusted;
}

function chooseBestFollowCamera(
  agent: WorldSnapshot["agents"][number],
  lookTarget: THREE.Vector3,
  structures: CityStructure[]
): THREE.Vector3 {
  const candidates = [
    getFollowCameraPosition(agent),
    getFollowCameraPosition(agent, { shoulder: -FOLLOW_CAMERA_SHOULDER }),
    getFollowCameraPosition(agent, { distance: FOLLOW_CAMERA_DISTANCE - 2.5, shoulder: FOLLOW_CAMERA_SHOULDER * 0.65 }),
    getFollowCameraPosition(agent, { distance: FOLLOW_CAMERA_DISTANCE - 2.5, shoulder: -FOLLOW_CAMERA_SHOULDER * 0.65 }),
    getFollowCameraPosition(agent, { height: FOLLOW_CAMERA_HEIGHT + 2.1, distance: FOLLOW_CAMERA_DISTANCE - 1.2, shoulder: FOLLOW_CAMERA_SHOULDER * 0.4 })
  ];

  let best = candidates[0];
  let bestPenalty = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const resolved = resolveCameraObstruction(candidate, lookTarget, structures);
    const displacement = candidate.distanceToSquared(resolved);
    const distancePenalty = Math.abs(candidate.distanceTo(lookTarget) - FOLLOW_CAMERA_DISTANCE) * 0.35;
    const heightPenalty = Math.abs(candidate.y - FOLLOW_CAMERA_HEIGHT) * 0.18;
    const penalty = displacement + distancePenalty + heightPenalty;
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      best = resolved;
    }
  }

  return best;
}

function CameraDirector({
  snapshot,
  selectedAgentId,
  streamedStructures,
  controlsRef,
  autoPausedUntilRef
}: {
  snapshot: WorldSnapshot | null;
  selectedAgentId?: string | null;
  streamedStructures: CityStructure[];
  controlsRef: RefObject<OrbitControlsImpl | null>;
  autoPausedUntilRef: MutableRefObject<number>;
}) {
  const targetRef = useRef(new THREE.Vector3(0, 1.2, 1));
  const cameraRef = useRef(new THREE.Vector3(24, 20, 24));

  useFrame((_, delta) => {
    const controls = controlsRef.current;
    if (!snapshot || !controls) {
      return;
    }

    if (performance.now() < autoPausedUntilRef.current) {
      return;
    }

    if (selectedAgentId) {
      const agent = snapshot.agents.find((candidate) => candidate.id === selectedAgentId);
      if (agent) {
        const desiredTarget = getFollowTargetPosition(agent);
        const desiredCamera = chooseBestFollowCamera(agent, desiredTarget, streamedStructures);
        targetRef.current.lerp(desiredTarget, Math.min(1, delta * FOLLOW_TARGET_LAG));
        cameraRef.current.lerp(desiredCamera, Math.min(1, delta * FOLLOW_CAMERA_LAG));
        controls.target.copy(targetRef.current);
        controls.object.position.copy(cameraRef.current);
        controls.update();
        return;
      }
    }

    const focus = getFocusPoint(snapshot, selectedAgentId);
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
    const forwardInput = (keys.w || keys.arrowup ? 1 : 0) - (keys.s || keys.arrowdown ? 1 : 0);
    const strafeInput = (keys.d || keys.arrowright ? 1 : 0) - (keys.a || keys.arrowleft ? 1 : 0);
    const verticalInput = (keys.e ? 1 : 0) - (keys.q ? 1 : 0);
    const hasInput = forwardInput !== 0 || strafeInput !== 0 || verticalInput !== 0;

    const speed = (keys.shift ? 36 : 16) * (keys.control ? 0.35 : 1);
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

function latestChatsByActor(chats: ChatMessage[]): Map<string, ChatMessage> {
  const map = new Map<string, ChatMessage>();
  for (let index = chats.length - 1; index >= 0; index -= 1) {
    const chat = chats[index];
    if (!map.has(chat.actorId)) {
      map.set(chat.actorId, chat);
    }
  }
  return map;
}

function recentVisibleChats(chats: ChatMessage[]): ChatMessage[] {
  const cutoff = Date.now() - ACTIVE_CHAT_MS;
  return chats.filter((chat) => new Date(chat.timestamp).getTime() >= cutoff);
}

export default function WorldScene({ snapshot, selectedAgentId, followAgentId, focusNonce = 0 }: Props) {
  const focusPoint = useMemo(() => getFocusPoint(snapshot, followAgentId), [snapshot, followAgentId]);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const autoPausedUntilRef = useRef(0);
  const userControllingRef = useRef(false);
  const lastFocusNonceRef = useRef(0);
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
  const colliders = useMemo(() => collidableStructures(streamedCity.near), [streamedCity.near]);

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

  const jobsById = useMemo(() => {
    const map = new Map<string, Job>();
    for (const job of snapshot?.jobs ?? []) {
      map.set(job.id, job);
    }
    return map;
  }, [snapshot?.jobs]);

  const liveChats = useMemo(() => recentVisibleChats(snapshot?.chats ?? []), [snapshot?.chats]);
  const chatsByActor = useMemo(() => latestChatsByActor(liveChats), [liveChats]);
  const selectedAgent = useMemo(() => snapshot?.agents.find((agent) => agent.id === selectedAgentId), [snapshot?.agents, selectedAgentId]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls || !snapshot || !selectedAgentId || focusNonce === 0 || focusNonce === lastFocusNonceRef.current) {
      return;
    }

    const agent = snapshot.agents.find((candidate) => candidate.id === selectedAgentId);
    if (!agent) {
      return;
    }

    autoPausedUntilRef.current = 0;
    lastFocusNonceRef.current = focusNonce;
    const followTarget = getFollowTargetPosition(agent);
    const followCamera = chooseBestFollowCamera(agent, followTarget, colliders);
    controls.target.copy(followTarget);
    controls.object.position.copy(followCamera);
    controls.update();
  }, [snapshot, selectedAgentId, focusNonce, colliders]);

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

      {snapshot ? <DistrictOverlay snapshot={snapshot} selectedAgentId={selectedAgentId} /> : null}
      <RoleHubLandmarks />
      {snapshot ? <PluginRegistryBoard plugins={snapshot.pluginAgents} /> : null}

      {streamedCity.far.map((structure) => (
        <StructureBlock key={`far-${structure.x}-${structure.z}-${structure.kind}`} structure={structure} />
      ))}
      {streamedCity.near.map((structure) => (
        <StructureBlock key={`near-${structure.x}-${structure.z}-${structure.kind}`} structure={structure} />
      ))}

      {(snapshot?.jobs ?? [])
        .filter((job) => job.status !== "completed" && job.status !== "failed")
        .map((job) => (
          <JobBeacon key={job.id} job={job} />
        ))}

      <Suspense fallback={null}>
        {(snapshot?.agents ?? []).map((agent) => (
          <AnimatedAgentAvatar
            key={agent.id}
            agent={agent}
            job={agent.assignedJobId ? jobsById.get(agent.assignedJobId) : undefined}
            chat={chatsByActor.get(agent.id)}
            selected={selectedAgentId === agent.id}
          />
        ))}
      </Suspense>

      {liveChats.map((chat) => {
        if (!chat.recipientId) {
          return null;
        }
        const from = snapshot?.agents.find((agent) => agent.id === chat.actorId);
        const to = snapshot?.agents.find((agent) => agent.id === chat.recipientId);
        if (!from || !to) {
          return null;
        }

        return (
          <Line
            key={chat.id}
            points={[
              [from.position.x, 1.8, from.position.y],
              [to.position.x, 1.8, to.position.y]
            ]}
            color={chat.tone === "warning" ? "#ff8a8a" : "#8de8ff"}
            dashed
            dashScale={2}
            dashSize={0.3}
            gapSize={0.18}
            transparent
            opacity={0.75}
            lineWidth={1.6}
          />
        );
      })}

      {Object.entries(trailMap).map(([agentId, points]) => {
        if (points.length < 2) {
          return null;
        }
        const agent = snapshot?.agents.find((candidate) => candidate.id === agentId);
        const color = agent ? AGENT_COLORS[agent.role] : "#9ecbff";
        return <Line key={agentId} points={points} color={color} lineWidth={1.4} transparent opacity={0.35} />;
      })}

      {(snapshot?.receipts ?? []).slice(-6).map((receipt, index) => (
        <group key={receipt.id} position={[focusPoint.x + 28, 0.8 + index * 1.1, focusPoint.y - 14]}>
          <mesh>
            <torusGeometry args={[0.3, 0.08, 9, 22]} />
            <meshStandardMaterial
              color={receipt.mode === "onchain" ? "#56ffd9" : "#ffd56c"}
              emissive={receipt.mode === "onchain" ? "#56ffd9" : "#ffd56c"}
              emissiveIntensity={1.35}
              metalness={0.2}
              roughness={0.15}
            />
          </mesh>
          <Text position={[0.9, 0, 0]} fontSize={0.12} color="#d7fffa" anchorX="left" anchorY="middle">
            {receipt.txHash.slice(0, 10)}
          </Text>
        </group>
      ))}

      <CameraDirector snapshot={snapshot} selectedAgentId={followAgentId} streamedStructures={colliders} controlsRef={controlsRef} autoPausedUntilRef={autoPausedUntilRef} />
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
