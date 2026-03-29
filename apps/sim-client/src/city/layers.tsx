import { useMemo, useRef } from "react";
import { Float, Html, Line, useGLTF } from "@react-three/drei";
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

function structureVariantSeed(structure: CityStructure): number {
  return Math.abs(Math.round(structure.x * 17 + structure.z * 31 + structure.height * 13));
}

function chooseBySeed<T>(items: T[], seed: number): T {
  return items[seed % items.length];
}

function pickKenneyAsset(structure: CityStructure): string | null {
  if (structure.kind === "park") {
    return null;
  }

  const seed = structureVariantSeed(structure);

  if (structure.kind === "tree") {
    return "/assets/kenney/suburban/tree-large.glb";
  }

  if (structure.kind === "house") {
    return chooseBySeed(
      [
        "/assets/kenney/suburban/building-type-a.glb",
        "/assets/kenney/suburban/building-type-j.glb",
        "/assets/kenney/suburban/building-type-q.glb"
      ],
      seed
    );
  }

  if (structure.kind === "warehouse") {
    return chooseBySeed(
      [
        "/assets/kenney/industrial/building-a.glb",
        "/assets/kenney/industrial/building-q.glb",
        "/assets/kenney/industrial/building-r.glb"
      ],
      seed
    );
  }

  if (structure.kind === "institution") {
    if (structure.districtTheme === "industrial") {
      return chooseBySeed(["/assets/kenney/industrial/building-q.glb", "/assets/kenney/industrial/building-r.glb"], seed);
    }
    if (structure.districtTheme === "residential") {
      return chooseBySeed(["/assets/kenney/suburban/building-type-j.glb", "/assets/kenney/suburban/building-type-q.glb"], seed);
    }
    return chooseBySeed(["/assets/kenney/commercial/building-a.glb", "/assets/kenney/commercial/building-f.glb"], seed);
  }

  if (structure.kind === "midrise") {
    if (structure.districtTheme === "industrial") {
      return chooseBySeed(["/assets/kenney/industrial/building-a.glb", "/assets/kenney/industrial/building-q.glb"], seed);
    }
    if (structure.districtTheme === "residential") {
      return chooseBySeed(["/assets/kenney/suburban/building-type-a.glb", "/assets/kenney/suburban/building-type-j.glb"], seed);
    }
    return chooseBySeed(["/assets/kenney/commercial/building-a.glb", "/assets/kenney/commercial/building-f.glb"], seed);
  }

  if (structure.kind === "tower") {
    return chooseBySeed(
      [
        "/assets/kenney/commercial/building-skyscraper-a.glb",
        "/assets/kenney/commercial/building-skyscraper-c.glb",
        "/assets/kenney/commercial/building-skyscraper-e.glb"
      ],
      seed
    );
  }

  return null;
}

function KenneyStructure({ structure, path }: { structure: CityStructure; path: string }) {
  const { scene } = useGLTF(path);
  const prepared = useMemo(() => {
    const next = scene.clone(true);
    next.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = structure.lod === "near";
        child.receiveShadow = true;
      }
    });
    return next;
  }, [scene, structure.lod]);

  const bbox = useMemo(() => new THREE.Box3().setFromObject(scene), [scene]);
  const size = useMemo(() => bbox.getSize(new THREE.Vector3()), [bbox]);
  const center = useMemo(() => bbox.getCenter(new THREE.Vector3()), [bbox]);
  const seeded = structureVariantSeed(structure);
  const rotationY = ((seeded % 4) * Math.PI) / 2;

  const scale = useMemo(() => {
    const safeX = Math.max(size.x, 0.001);
    const safeY = Math.max(size.y, 0.001);
    const safeZ = Math.max(size.z, 0.001);
    const footprintMultiplier =
      structure.kind === "tower"
        ? 2.35
        : structure.kind === "midrise"
          ? 2.7
          : structure.kind === "warehouse"
            ? 2.9
            : structure.kind === "institution"
              ? 2.6
              : structure.kind === "house"
                ? 3.25
                : structure.kind === "tree"
                  ? 3.4
                  : 2.6;
    const heightMultiplier =
      structure.kind === "tower"
        ? 2.7
        : structure.kind === "midrise"
          ? 2.8
          : structure.kind === "warehouse"
            ? 2.6
            : structure.kind === "institution"
              ? 2.6
              : structure.kind === "house"
                ? 3.0
                : structure.kind === "tree"
                  ? 3.2
                  : 2.6;
    const widthScale = (structure.width * footprintMultiplier) / safeX;
    const depthScale = (structure.depth * footprintMultiplier) / safeZ;
    const heightScale = (structure.height * heightMultiplier) / safeY;
    return Math.min(widthScale, depthScale, heightScale);
  }, [size.x, size.y, size.z, structure.width, structure.depth, structure.height, structure.kind]);

  return (
    <group position={[structure.x, 0, structure.z]} rotation={[0, rotationY, 0]}>
      <primitive object={prepared} position={[-center.x * scale, -bbox.min.y * scale, -center.z * scale]} scale={[scale, scale, scale]} />
    </group>
  );
}

const PRELOAD_KENNEY_PATHS = [
  "/assets/kenney/commercial/building-a.glb",
  "/assets/kenney/commercial/building-f.glb",
  "/assets/kenney/commercial/building-skyscraper-a.glb",
  "/assets/kenney/commercial/building-skyscraper-c.glb",
  "/assets/kenney/commercial/building-skyscraper-e.glb",
  "/assets/kenney/industrial/building-a.glb",
  "/assets/kenney/industrial/building-q.glb",
  "/assets/kenney/industrial/building-r.glb",
  "/assets/kenney/industrial/chimney-large.glb",
  "/assets/kenney/industrial/chimney-medium.glb",
  "/assets/kenney/industrial/detail-tank.glb",
  "/assets/kenney/suburban/building-type-a.glb",
  "/assets/kenney/suburban/building-type-j.glb",
  "/assets/kenney/suburban/building-type-q.glb",
  "/assets/kenney/suburban/path-long.glb",
  "/assets/kenney/suburban/planter.glb",
  "/assets/kenney/suburban/tree-large.glb"
];

for (const path of PRELOAD_KENNEY_PATHS) {
  useGLTF.preload(path);
}

type KitAssetSpec = {
  path: string;
  position: [number, number, number];
  fit: [number, number, number];
  rotationY?: number;
};

function KitAsset({ path, position, fit, rotationY = 0 }: KitAssetSpec) {
  const { scene } = useGLTF(path);
  const prepared = useMemo(() => {
    const next = scene.clone(true);
    next.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    return next;
  }, [scene]);

  const bbox = useMemo(() => new THREE.Box3().setFromObject(scene), [scene]);
  const size = useMemo(() => bbox.getSize(new THREE.Vector3()), [bbox]);
  const center = useMemo(() => bbox.getCenter(new THREE.Vector3()), [bbox]);
  const scale = useMemo(() => {
    const safeX = Math.max(size.x, 0.001);
    const safeY = Math.max(size.y, 0.001);
    const safeZ = Math.max(size.z, 0.001);
    return Math.min(fit[0] / safeX, fit[1] / safeY, fit[2] / safeZ);
  }, [fit, size.x, size.y, size.z]);

  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <primitive object={prepared} position={[-center.x * scale, -bbox.min.y * scale, -center.z * scale]} scale={[scale, scale, scale]} />
    </group>
  );
}

function HubKitScene({ role }: { role: keyof typeof ROLE_HUBS }) {
  const runway = (
    <>
      <KitAsset path="/assets/kenney/suburban/path-long.glb" position={[0, 0.02, 2.25]} fit={[2.6, 0.32, 7.8]} />
      <KitAsset path="/assets/kenney/suburban/path-long.glb" position={[0, 0.02, -2.35]} fit={[2.6, 0.32, 7.8]} />
    </>
  );

  if (role === "scout") {
    return (
      <group>
        {runway}
        <KitAsset path="/assets/kenney/suburban/building-type-a.glb" position={[-5.4, 0, -4.2]} fit={[4.4, 7.5, 4.4]} rotationY={Math.PI / 2} />
        <KitAsset path="/assets/kenney/suburban/building-type-j.glb" position={[4.8, 0, -4.6]} fit={[4.6, 8.2, 4.6]} rotationY={-Math.PI / 2} />
        <KitAsset path="/assets/kenney/suburban/building-type-q.glb" position={[-0.8, 0, 6.1]} fit={[4.4, 7.8, 4.4]} rotationY={Math.PI} />
        <KitAsset path="/assets/kenney/suburban/tree-large.glb" position={[-6.8, 0, 5.2]} fit={[2.8, 4.8, 2.8]} />
        <KitAsset path="/assets/kenney/suburban/tree-large.glb" position={[4.8, 0, 1.1]} fit={[2.5, 4.4, 2.5]} />
      </group>
    );
  }

  if (role === "planner") {
    return (
      <group>
        <KitAsset path="/assets/kenney/suburban/path-long.glb" position={[0, 0.02, 0]} fit={[3.1, 0.4, 8.8]} rotationY={Math.PI / 2} />
        <KitAsset path="/assets/kenney/suburban/path-long.glb" position={[0, 0.02, 0]} fit={[3.1, 0.4, 8.8]} />
        <KitAsset path="/assets/kenney/commercial/building-f.glb" position={[0, 0, -6.7]} fit={[7.8, 11.5, 5.2]} />
        <KitAsset path="/assets/kenney/commercial/building-a.glb" position={[-6.6, 0, 2.8]} fit={[4.6, 8.2, 4.2]} rotationY={Math.PI / 2} />
        <KitAsset path="/assets/kenney/commercial/building-a.glb" position={[6.6, 0, 2.8]} fit={[4.6, 8.2, 4.2]} rotationY={-Math.PI / 2} />
        <KitAsset path="/assets/kenney/suburban/planter.glb" position={[-2.4, 0.02, 3.6]} fit={[1.4, 0.8, 1.4]} />
        <KitAsset path="/assets/kenney/suburban/planter.glb" position={[2.4, 0.02, 3.6]} fit={[1.4, 0.8, 1.4]} rotationY={Math.PI / 3} />
      </group>
    );
  }

  if (role === "builder") {
    return (
      <group>
        <mesh position={[0, 0.03, 0]} receiveShadow>
          <boxGeometry args={[18.4, 0.12, 16.2]} />
          <meshStandardMaterial color="#151817" emissive="#1a211d" emissiveIntensity={0.08} roughness={0.96} metalness={0.04} />
        </mesh>
        <mesh position={[0, 0.045, -5.6]} receiveShadow>
          <boxGeometry args={[15.8, 0.04, 2.2]} />
          <meshStandardMaterial color="#2b2f2a" emissive="#52462c" emissiveIntensity={0.1} roughness={0.92} />
        </mesh>
        <mesh position={[0, 0.045, 3.4]} receiveShadow>
          <boxGeometry args={[14.8, 0.04, 2]} />
          <meshStandardMaterial color="#242826" emissive="#3f5535" emissiveIntensity={0.06} roughness={0.92} />
        </mesh>
        {[-4.8, -1.6, 1.6, 4.8].map((x) => (
          <mesh key={`builder-track-${x}`} position={[x, 0.06, 0]}>
            <boxGeometry args={[0.12, 0.05, 12.8]} />
            <meshStandardMaterial color="#5f5747" emissive="#5f5747" emissiveIntensity={0.08} roughness={0.7} metalness={0.24} />
          </mesh>
        ))}
        {[-3.2, 0, 3.2].map((x) => (
          <mesh key={`builder-pad-${x}`} position={[x, 0.12, 1.1]} castShadow receiveShadow>
            <boxGeometry args={[1.4, 0.18, 1.1]} />
            <meshStandardMaterial color="#48503f" emissive="#6a7b4b" emissiveIntensity={0.12} roughness={0.8} metalness={0.12} />
          </mesh>
        ))}
        <mesh position={[0, 0.12, -1.4]} castShadow receiveShadow>
          <boxGeometry args={[3.8, 0.18, 1.5]} />
          <meshStandardMaterial color="#5c4830" emissive="#8f6f3b" emissiveIntensity={0.14} roughness={0.76} metalness={0.12} />
        </mesh>
        <mesh position={[-6.9, 2.4, -0.4]} castShadow>
          <boxGeometry args={[0.24, 4.8, 0.24]} />
          <meshStandardMaterial color="#2f3830" emissive="#436048" emissiveIntensity={0.18} roughness={0.42} metalness={0.34} />
        </mesh>
        <mesh position={[-4.9, 4.1, -0.4]} castShadow>
          <boxGeometry args={[4.4, 0.16, 0.22]} />
          <meshStandardMaterial color="#4e6a43" emissive="#9fe16e" emissiveIntensity={0.26} roughness={0.36} metalness={0.26} />
        </mesh>
        <mesh position={[-2.8, 3.2, -0.4]} castShadow>
          <boxGeometry args={[0.18, 1.7, 0.18]} />
          <meshStandardMaterial color="#4e6a43" emissive="#9fe16e" emissiveIntensity={0.22} roughness={0.42} metalness={0.18} />
        </mesh>
        <KitAsset path="/assets/kenney/industrial/building-a.glb" position={[-7.1, 0, -5.8]} fit={[6.8, 10.8, 5.8]} rotationY={Math.PI / 2} />
        <KitAsset path="/assets/kenney/industrial/building-q.glb" position={[7.1, 0, -5.9]} fit={[6.8, 11.4, 5.6]} rotationY={-Math.PI / 2} />
        <KitAsset path="/assets/kenney/industrial/building-r.glb" position={[0.4, 0, 7.6]} fit={[8.2, 12.2, 6.6]} rotationY={Math.PI} />
        <KitAsset path="/assets/kenney/industrial/chimney-large.glb" position={[-3.2, 0, -8.1]} fit={[1.8, 9.8, 1.8]} />
        <KitAsset path="/assets/kenney/industrial/chimney-medium.glb" position={[3.0, 0, -8]} fit={[1.55, 8.2, 1.55]} />
        <KitAsset path="/assets/kenney/industrial/detail-tank.glb" position={[-6.2, 0, 5.4]} fit={[2.6, 2.2, 2.6]} />
        <KitAsset path="/assets/kenney/industrial/detail-tank.glb" position={[6.2, 0, 5.2]} fit={[2.6, 2.2, 2.6]} rotationY={Math.PI / 4} />
      </group>
    );
  }

  if (role === "verifier") {
    return (
      <group>
        <KitAsset path="/assets/kenney/suburban/path-long.glb" position={[0, 0.02, -0.4]} fit={[2.8, 0.32, 9.2]} />
        <KitAsset path="/assets/kenney/commercial/building-a.glb" position={[-5.9, 0, -5.8]} fit={[4.6, 8.4, 4.4]} rotationY={Math.PI / 2} />
        <KitAsset path="/assets/kenney/commercial/building-a.glb" position={[5.9, 0, -5.8]} fit={[4.6, 8.4, 4.4]} rotationY={-Math.PI / 2} />
        <KitAsset path="/assets/kenney/commercial/building-f.glb" position={[0, 0, 6.5]} fit={[6.2, 10.2, 4.8]} rotationY={Math.PI} />
        <KitAsset path="/assets/kenney/suburban/planter.glb" position={[-2.8, 0.02, 3.8]} fit={[1.2, 0.72, 1.2]} />
        <KitAsset path="/assets/kenney/suburban/planter.glb" position={[2.8, 0.02, 3.8]} fit={[1.2, 0.72, 1.2]} rotationY={Math.PI / 4} />
      </group>
    );
  }

  return (
    <group>
      <KitAsset path="/assets/kenney/commercial/building-skyscraper-a.glb" position={[-6.8, 0, -3.8]} fit={[5.4, 15.8, 5.2]} rotationY={Math.PI / 2} />
      <KitAsset path="/assets/kenney/commercial/building-skyscraper-c.glb" position={[0, 0, -7.6]} fit={[6.4, 18.4, 5.8]} />
      <KitAsset path="/assets/kenney/commercial/building-skyscraper-e.glb" position={[7.2, 0, -3.6]} fit={[5.2, 16.4, 5.2]} rotationY={-Math.PI / 2} />
      <KitAsset path="/assets/kenney/suburban/path-long.glb" position={[0, 0.02, 3.2]} fit={[3, 0.4, 9.4]} rotationY={Math.PI / 2} />
      <KitAsset path="/assets/kenney/suburban/planter.glb" position={[-2.8, 0.02, 4.8]} fit={[1.3, 0.8, 1.3]} />
      <KitAsset path="/assets/kenney/suburban/planter.glb" position={[2.8, 0.02, 4.8]} fit={[1.3, 0.8, 1.3]} rotationY={Math.PI / 4} />
    </group>
  );
}

export function DistrictSetpieces() {
  const hubs = useMemo(() => Object.entries(ROLE_HUBS) as Array<[keyof typeof ROLE_HUBS, (typeof ROLE_HUBS)[keyof typeof ROLE_HUBS]]>, []);

  return (
    <group>
      {hubs.map(([role, hub]) => (
        <group key={`${role}-setpiece`} position={[hub.position.x, 0, hub.position.y]}>
          <HubKitScene role={role} />
        </group>
      ))}
    </group>
  );
}

export function StructureBlock({ structure }: { structure: CityStructure }) {
  const kenneyPath = structure.lod === "near" ? pickKenneyAsset(structure) : null;
  if (kenneyPath) {
    return <KenneyStructure structure={structure} path={kenneyPath} />;
  }

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
        <mesh position={[0, 0.03, 0]} receiveShadow>
          <boxGeometry args={[5.8, 0.08, 4.8]} />
          <meshStandardMaterial color="#151a16" emissive="#1c231c" emissiveIntensity={0.06} roughness={0.95} />
        </mesh>
        <mesh position={[0, 0.09, -1.45]} receiveShadow>
          <boxGeometry args={[4.9, 0.08, 0.42]} />
          <meshStandardMaterial color="#5d4a2f" emissive="#7f6334" emissiveIntensity={0.1} roughness={0.82} />
        </mesh>
        <mesh position={[0, 0.09, 1.45]} receiveShadow>
          <boxGeometry args={[4.9, 0.08, 0.42]} />
          <meshStandardMaterial color="#274230" emissive="#365d42" emissiveIntensity={0.08} roughness={0.84} />
        </mesh>
        {[-1.8, 0, 1.8].map((x) => (
          <mesh key={x} position={[x, 0.11, -0.2]} receiveShadow>
            <boxGeometry args={[0.62, 0.12, 2.6]} />
            <meshStandardMaterial color="#3f463f" emissive="#596857" emissiveIntensity={0.08} roughness={0.84} metalness={0.12} />
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
        <mesh position={[0, 0.22, 0]} castShadow>
          <boxGeometry args={[0.86, 0.36, 0.86]} />
          <meshStandardMaterial color="#273128" emissive="#35563e" emissiveIntensity={0.18} metalness={0.22} roughness={0.4} />
        </mesh>
        <mesh position={[-0.54, 1.3, 0]} castShadow>
          <boxGeometry args={[0.18, 2.4, 0.18]} />
          <meshStandardMaterial color="#314135" emissive="#4a6e57" emissiveIntensity={0.18} metalness={0.28} roughness={0.34} />
        </mesh>
        <mesh position={[0.58, 1.9, 0]} castShadow rotation={[0, 0, -Math.PI / 16]}>
          <boxGeometry args={[2.5, 0.16, 0.16]} />
          <meshStandardMaterial color="#567246" emissive="#98dd69" emissiveIntensity={0.28} metalness={0.24} roughness={0.32} />
        </mesh>
        <mesh position={[1.68, 1.28, 0]} castShadow>
          <boxGeometry args={[0.18, 1.26, 0.18]} />
          {glowMaterial(color, 0.92, 0.88)}
        </mesh>
        <mesh position={[1.68, 0.58, 0]} castShadow>
          <boxGeometry args={[0.36, 0.18, 0.36]} />
          {glowMaterial("#e9ffc1", 1.08, 0.9)}
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
