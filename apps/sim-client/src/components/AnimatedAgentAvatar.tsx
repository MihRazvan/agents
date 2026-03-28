import { useEffect, useMemo, useRef } from "react";
import { Html, Line, Text, useAnimations, useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { AGENT_COLORS, type AgentRuntimeState, type ChatMessage, type Job } from "@trust-city/shared";

interface Props {
  agent: AgentRuntimeState;
  job?: Job;
  chat?: ChatMessage;
  selected?: boolean;
}

const PHASE_TO_CLIP: Record<string, string> = {
  idle: "Idle",
  discover: "Walking",
  plan: "Idle",
  execute: "Running",
  verify: "Walking",
  submit: "Running",
  blocked: "Idle"
};

function worldPoint(position: { x: number; y: number }, y = 0.92): [number, number, number] {
  return [position.x, y, position.y];
}

const POSITION_DAMP = 8.8;
const ROTATION_DAMP = 11.5;
const MODEL_FORWARD_OFFSET = 0;

export default function AnimatedAgentAvatar({ agent, job, chat, selected = false }: Props) {
  const rootRef = useRef<THREE.Group>(null);
  const auraRef = useRef<THREE.Mesh>(null);
  const clipRef = useRef<string>("Idle");
  const headingRef = useRef(0);
  const currentPosRef = useRef(new THREE.Vector3(agent.position.x, 0.92, agent.position.y));
  const targetPosRef = useRef(new THREE.Vector3(agent.position.x, 0.92, agent.position.y));
  const previousPosRef = useRef(new THREE.Vector3(agent.position.x, 0.92, agent.position.y));
  const speedRef = useRef(0);

  const { scene, animations } = useGLTF("/assets/characters/RobotExpressive.glb");

  const model = useMemo(() => {
    const copy = clone(scene) as THREE.Group;
    copy.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) {
        return;
      }
      if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map((material) => material.clone());
      } else if (mesh.material) {
        mesh.material = mesh.material.clone();
      }
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
    return copy;
  }, [scene]);

  const { actions } = useAnimations(animations, rootRef);
  const color = AGENT_COLORS[agent.role];

  useEffect(() => {
    const nextWaypoint = agent.path[0] ?? agent.target;
    const dx = nextWaypoint.x - agent.position.x;
    const dz = nextWaypoint.y - agent.position.y;
    const length = Math.hypot(dx, dz) || 1;
    const lead = agent.phase === "idle" ? 0 : Math.min(0.72, 0.16 + length * 0.28);
    targetPosRef.current.set(agent.position.x + (dx / length) * lead, 0.92, agent.position.y + (dz / length) * lead);
  }, [agent.position.x, agent.position.y, agent.target.x, agent.target.y, agent.phase, agent.path]);

  useEffect(() => {
    const desired = PHASE_TO_CLIP[agent.phase] ?? "Idle";
    if (clipRef.current === desired) {
      return;
    }

    const nextAction = actions[desired] ?? actions.Idle;
    if (!nextAction) {
      return;
    }

    const previous = actions[clipRef.current];
    previous?.fadeOut(0.25);
    nextAction.reset().fadeIn(0.25).play();
    clipRef.current = desired;
  }, [agent.phase, actions]);

  useEffect(() => {
    const bootAction = actions[clipRef.current] ?? actions.Idle;
    bootAction?.reset().fadeIn(0.2).play();

    return () => {
      Object.values(actions).forEach((action) => action?.fadeOut(0.2));
    };
  }, [actions]);

  useFrame(({ clock }, delta) => {
    if (!rootRef.current) {
      return;
    }

    currentPosRef.current.x = THREE.MathUtils.damp(currentPosRef.current.x, targetPosRef.current.x, POSITION_DAMP, delta);
    currentPosRef.current.z = THREE.MathUtils.damp(currentPosRef.current.z, targetPosRef.current.z, POSITION_DAMP, delta);
    rootRef.current.position.x = currentPosRef.current.x;
    rootRef.current.position.z = currentPosRef.current.z;

    const moveDx = currentPosRef.current.x - previousPosRef.current.x;
    const moveDz = currentPosRef.current.z - previousPosRef.current.z;
    const frameDistance = Math.sqrt(moveDx * moveDx + moveDz * moveDz);
    speedRef.current = THREE.MathUtils.damp(speedRef.current, frameDistance / Math.max(delta, 1e-4), 9, delta);

    if (frameDistance > 0.0008) {
      headingRef.current = Math.atan2(moveDx, moveDz);
    } else {
      const lookDx = targetPosRef.current.x - currentPosRef.current.x;
      const lookDz = targetPosRef.current.z - currentPosRef.current.z;
      if (Math.hypot(lookDx, lookDz) > 0.0008) {
        headingRef.current = Math.atan2(lookDx, lookDz);
      }
    }

    rootRef.current.rotation.y = THREE.MathUtils.damp(rootRef.current.rotation.y, headingRef.current + MODEL_FORWARD_OFFSET, ROTATION_DAMP, delta);
    rootRef.current.position.y = 0.92 + Math.sin(clock.getElapsedTime() * 4.8 + currentPosRef.current.x) * 0.03;
    previousPosRef.current.copy(currentPosRef.current);

    const active = actions[clipRef.current] ?? actions.Idle;
    if (active) {
      const speedNorm = THREE.MathUtils.clamp(speedRef.current / 2.2, 0, 1.7);
      active.timeScale = agent.phase === "execute" ? 1.05 + speedNorm * 0.55 : 0.8 + speedNorm * 0.45;
      active.weight = 1;
    }

    if (auraRef.current) {
      const pulse = 0.82 + Math.sin(clock.getElapsedTime() * 2.6) * 0.12;
      const scale = pulse + agent.trustScore * 0.42 + (selected ? 0.28 : 0);
      auraRef.current.scale.set(scale, scale, 1);
    }
  });

  return (
    <group ref={rootRef} position={worldPoint(agent.position)}>
      <mesh ref={auraRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.78, 0]}>
        <ringGeometry args={[0.56, 0.76, 36]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.18} transparent opacity={0.35 + agent.trustScore * 0.2} />
      </mesh>

      {selected ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.8, 0]}>
          <ringGeometry args={[0.84, 0.94, 42]} />
          <meshStandardMaterial color="#f5f8ff" emissive="#b9e8ff" emissiveIntensity={1.2} transparent opacity={0.7} />
        </mesh>
      ) : null}

      <primitive object={model} position={[0, -0.92, 0]} scale={[0.6, 0.6, 0.6]} />

      <mesh position={[0, 1.14, 0]}>
        <sphereGeometry args={[0.12, 16, 16]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.15} />
      </mesh>

      {job ? (
        <Line
          points={[
            [0, 0.38, 0],
            [job.position.x - agent.position.x, 0.3, job.position.y - agent.position.y]
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

      <Text position={[0, 1.68, 0]} fontSize={0.24} color="#f3f8ff" anchorX="center" anchorY="bottom" maxWidth={5.8}>
        {agent.name}
      </Text>
      <Text position={[0, 1.4, 0]} fontSize={0.13} color="#9bc0ea" anchorX="center" anchorY="bottom" maxWidth={6.8}>
        {agent.statusLine ?? agent.specialty}
      </Text>

      {chat ? (
        <Html position={[0, 2.45, 0]} center distanceFactor={8}>
          <div className={`world-tag world-tag-chat ${chat.tone === "warning" ? "world-tag-chat-warning" : "world-tag-chat-decision"}`}>
            <p>{chat.recipientName ? `${chat.actorName} -> ${chat.recipientName}` : chat.actorName}</p>
            <span>{chat.message}</span>
          </div>
        </Html>
      ) : null}
    </group>
  );
}

useGLTF.preload("/assets/characters/RobotExpressive.glb");
