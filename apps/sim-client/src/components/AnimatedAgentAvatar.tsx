import { useEffect, useMemo, useRef } from "react";
import { Line, Text, useAnimations, useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { AGENT_COLORS, type AgentRuntimeState, type Incident } from "@trust-city/shared";

interface Props {
  agent: AgentRuntimeState;
  incident?: Incident;
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

function worldPoint(position: { x: number; y: number }, y = 0.72): [number, number, number] {
  return [position.x, y, position.y];
}

export default function AnimatedAgentAvatar({ agent, incident }: Props) {
  const rootRef = useRef<THREE.Group>(null);
  const auraRef = useRef<THREE.Mesh>(null);
  const clipRef = useRef<string>("Idle");

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
  const moving = agent.path.length > 0;

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

  const [x, y, z] = worldPoint(agent.position);

  useFrame(({ clock }, delta) => {
    if (!rootRef.current) {
      return;
    }

    const targetYaw = Math.atan2(agent.target.x - agent.position.x, agent.target.y - agent.position.y);
    rootRef.current.rotation.y = THREE.MathUtils.damp(rootRef.current.rotation.y, targetYaw + Math.PI, 7.5, delta);
    rootRef.current.position.y = y + Math.sin(clock.getElapsedTime() * 4.8 + agent.position.x) * 0.03;

    const active = actions[clipRef.current] ?? actions.Idle;
    if (active) {
      active.timeScale = agent.phase === "execute" ? 1.32 : moving ? 1.04 : 0.82;
      active.weight = 1;
    }

    if (auraRef.current) {
      const pulse = 0.82 + Math.sin(clock.getElapsedTime() * 2.6) * 0.12;
      const scale = pulse + agent.trustScore * 0.42;
      auraRef.current.scale.set(scale, scale, 1);
    }
  });

  return (
    <group ref={rootRef} position={[x, y, z]}>
      <mesh ref={auraRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.58, 0]}>
        <ringGeometry args={[0.42, 0.55, 32]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.18} transparent opacity={0.35 + agent.trustScore * 0.2} />
      </mesh>

      <primitive object={model} position={[0, -0.57, 0]} scale={[0.34, 0.34, 0.34]} />

      <mesh position={[0, 0.7, 0]}>
        <sphereGeometry args={[0.08, 14, 14]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.15} />
      </mesh>

      {incident ? (
        <Line
          points={[
            [0, 0.38, 0],
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

useGLTF.preload("/assets/characters/RobotExpressive.glb");
