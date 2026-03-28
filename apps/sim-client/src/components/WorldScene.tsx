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
const IDLE_CAMERA_RADIUS = 34;
const IDLE_CAMERA_HEIGHT = 18;
const IDLE_ORBIT_SPEED = 0.08;
const IDLE_TARGET_HEIGHT = 3.4;
const MIDNIGHT_BACKGROUND = "#050811";
const MIDNIGHT_FOG = "#08101b";

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

  useFrame((state, delta) => {
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
    const t = state.clock.getElapsedTime() * IDLE_ORBIT_SPEED;
    const desiredTarget = new THREE.Vector3(focus.x, IDLE_TARGET_HEIGHT, focus.y);
    const desiredCamera = new THREE.Vector3(
      focus.x + Math.cos(t) * IDLE_CAMERA_RADIUS,
      IDLE_CAMERA_HEIGHT + Math.sin(t * 0.7) * 2.2,
      focus.y + Math.sin(t) * (IDLE_CAMERA_RADIUS * 0.74)
    );
    targetRef.current.lerp(desiredTarget, Math.min(1, delta * 1.45));
    cameraRef.current.lerp(desiredCamera, Math.min(1, delta * 0.62));
    controls.object.position.copy(cameraRef.current);
    controls.target.copy(targetRef.current);
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

function ExchangeBackdrop({ center }: { center: Vec2 }) {
  const skyline = useMemo(() => {
    return Array.from({ length: 36 }).map((_, index) => {
      const angle = (index / 36) * Math.PI * 2;
      const radius = 148 + (index % 6) * 12;
      const width = 4 + (index % 4) * 1.2;
      const depth = 4.5 + ((index + 2) % 5) * 1.1;
      const height = 18 + (index % 7) * 7 + ((index * 13) % 5);
      const x = center.x + Math.cos(angle) * radius;
      const z = center.y + Math.sin(angle) * radius;
      const hue = index % 3 === 0 ? "#13233b" : index % 3 === 1 ? "#1a2030" : "#17283a";
      const beacon = index % 4 === 0;
      return { x, z, width, depth, height, hue, beacon };
    });
  }, [center.x, center.y]);

  return (
    <group>
      {skyline.map((tower, index) => (
        <group key={`${tower.x}-${tower.z}-${index}`} position={[tower.x, 0, tower.z]}>
          <mesh position={[0, tower.height / 2, 0]}>
            <boxGeometry args={[tower.width, tower.height, tower.depth]} />
            <meshStandardMaterial color={tower.hue} emissive={tower.hue} emissiveIntensity={0.18} roughness={0.62} metalness={0.22} />
          </mesh>
          <mesh position={[0, 0.08, 0]}>
            <cylinderGeometry args={[tower.width * 0.58, tower.width * 0.66, 0.16, 16]} />
            <meshStandardMaterial color="#102131" emissive="#17354f" emissiveIntensity={0.2} roughness={0.78} />
          </mesh>
          {tower.beacon ? (
            <>
              <mesh position={[0, tower.height + 1.4, 0]}>
                <boxGeometry args={[0.34, 2.8, 0.34]} />
                <meshStandardMaterial color="#67dcff" emissive="#67dcff" emissiveIntensity={1.35} transparent opacity={0.88} />
              </mesh>
              <mesh position={[0, tower.height + 0.24, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[1.2, 1.5, 28]} />
                <meshStandardMaterial color="#67dcff" emissive="#67dcff" emissiveIntensity={0.8} transparent opacity={0.18} />
              </mesh>
            </>
          ) : null}
        </group>
      ))}
    </group>
  );
}

function ExchangeFloor({ center }: { center: Vec2 }) {
  return (
    <group position={[center.x, 0, center.y]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[132, 96]} />
        <meshStandardMaterial color="#0d1521" emissive="#0b1521" emissiveIntensity={0.18} roughness={0.96} metalness={0.08} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <circleGeometry args={[124, 80]} />
        <meshStandardMaterial color="#0b121c" emissive="#0c1620" emissiveIntensity={0.08} roughness={1} metalness={0.04} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[74, 74.8, 72]} />
        <meshStandardMaterial color="#445263" emissive="#445263" emissiveIntensity={0.08} transparent opacity={0.34} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry args={[118, 118.8, 96]} />
        <meshStandardMaterial color="#56493a" emissive="#56493a" emissiveIntensity={0.04} transparent opacity={0.18} />
      </mesh>
      {[-84, -42, 0, 42, 84].map((offset) => (
        <mesh key={`h-${offset}`} position={[0, 0.02, offset]}>
          <boxGeometry args={[192, 0.01, 0.14]} />
          <meshStandardMaterial color="#24303e" emissive="#24303e" emissiveIntensity={0.04} transparent opacity={0.22} />
        </mesh>
      ))}
      {[-84, -42, 0, 42, 84].map((offset) => (
        <mesh key={`v-${offset}`} position={[offset, 0.02, 0]}>
          <boxGeometry args={[0.14, 0.01, 192]} />
          <meshStandardMaterial color="#24303e" emissive="#24303e" emissiveIntensity={0.04} transparent opacity={0.22} />
        </mesh>
      ))}
    </group>
  );
}

function ExchangeAurora({ center }: { center: Vec2 }) {
  const ribbon = useMemo<Array<[number, number, number]>>(
    () =>
      Array.from({ length: 18 }).map((_, index) => {
        const t = index / 17;
        return [center.x - 120 + t * 240, 44 + Math.sin(t * Math.PI * 1.4) * 8, center.y - 128 + Math.cos(t * Math.PI * 1.7) * 18];
      }),
    [center.x, center.y]
  );

  return <Line points={ribbon} color="#4fd2ff" lineWidth={2.4} transparent opacity={0.12} />;
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
      <color attach="background" args={[MIDNIGHT_BACKGROUND]} />
      <fog attach="fog" args={[MIDNIGHT_FOG, 72, 360]} />

      <ambientLight intensity={0.22} color="#7ca9ff" />
      <hemisphereLight args={["#7eb7ff", "#061018", 0.58]} />
      <directionalLight
        position={[-32, 18, -20]}
        intensity={1.5}
        color="#ffc98c"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <directionalLight position={[40, 42, 22]} intensity={0.56} color="#73c7ff" />
      <spotLight position={[-14, 18, -8]} intensity={130} distance={140} angle={0.36} penumbra={0.8} color="#3fd6ff" />
      <pointLight position={[24, 14, -24]} intensity={28} distance={140} color="#ff9f5a" />
      <pointLight position={[-36, 16, 28]} intensity={22} distance={128} color="#57cfff" />

      <Sky distance={1800} sunPosition={[-90, 8, -60]} turbidity={12} rayleigh={0.9} mieCoefficient={0.012} mieDirectionalG={0.92} />
      <Stars radius={240} depth={140} count={8200} factor={4.8} fade saturation={0} speed={0.8} />
      <ExchangeAurora center={streamAnchor} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[streamAnchor.x, 0, streamAnchor.y]}>
        <planeGeometry args={[960, 960, 1, 1]} />
        <meshStandardMaterial color="#0a0f18" emissive="#09111d" emissiveIntensity={0.12} metalness={0.06} roughness={0.98} />
      </mesh>
      <ExchangeFloor center={streamAnchor} />
      <ExchangeBackdrop center={streamAnchor} />

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
        <Bloom intensity={1.5} luminanceThreshold={0.14} luminanceSmoothing={0.72} mipmapBlur />
        <Noise opacity={0.018} />
        <Vignette offset={0.2} darkness={0.7} eskil={false} />
      </EffectComposer>
    </Canvas>
  );
}
