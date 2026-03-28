import type { Vec2 } from "@trust-city/shared";

interface GridPoint {
  x: number;
  y: number;
}

export interface NavigationConfig {
  worldSeed: number;
  gridMin: number;
  gridMax: number;
  gridStep: number;
  roadMajorSpacing: number;
  roadMinorSpacing: number;
  roadMajorHalfWidth: number;
  roadMinorHalfWidth: number;
}

export interface CrowdAgentConfig {
  radius?: number;
  height?: number;
  maxAcceleration?: number;
  maxSpeed?: number;
  collisionQueryRange?: number;
  pathOptimizationRange?: number;
  separationWeight?: number;
}

interface CrowdAgentSnapshot {
  position: Vec2;
  velocity: Vec2;
  path: Vec2[];
  target: Vec2;
}

interface RecastCrowdAgent {
  requestMoveTarget(position: { x: number; y: number; z: number }): boolean;
  resetMoveTarget(): void;
  teleport(position: { x: number; y: number; z: number }): void;
  position(): { x: number; y: number; z: number };
  velocity(): { x: number; y: number; z: number };
  target(): { x: number; y: number; z: number };
  corners(): Array<{ x: number; y: number; z: number }>;
}

interface RecastCrowd {
  addAgent(position: { x: number; y: number; z: number }, params: Record<string, unknown>): RecastCrowdAgent;
  removeAgent(agent: RecastCrowdAgent): void;
  update(dt: number): void;
}

export interface NavigationApi {
  ensureWalkable: (point: Vec2) => Vec2;
  planPath: (start: Vec2, goal: Vec2) => Vec2[];
  distance: (a: Vec2, b: Vec2) => number;
  registerCrowdAgent: (id: string, position: Vec2, config?: CrowdAgentConfig) => Vec2;
  removeCrowdAgent: (id: string) => void;
  setCrowdAgentTarget: (id: string, target: Vec2) => Vec2[];
  resetCrowdAgentTarget: (id: string) => void;
  stepCrowd: (deltaSeconds: number) => void;
  syncCrowdAgent: (id: string) => CrowdAgentSnapshot | null;
}

const QUERY_HALF_EXTENTS = { x: 3, y: 4, z: 3 };

function keyForCell(cell: GridPoint): string {
  return `${cell.x},${cell.y}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function distanceToGridLine(value: number, spacing: number): number {
  const mod = ((value % spacing) + spacing) % spacing;
  return Math.min(mod, spacing - mod);
}

function nearestGridLine(value: number, spacing: number): number {
  return Math.round(value / spacing) * spacing;
}

function toVector3(point: Vec2) {
  return { x: point.x, y: 0, z: point.y };
}

function fromVector3(point: { x: number; y: number; z: number }): Vec2 {
  return { x: point.x, y: point.z };
}

function pushQuad(positions: number[], indices: number[], minX: number, minZ: number, maxX: number, maxZ: number): void {
  const base = positions.length / 3;
  positions.push(minX, 0, minZ, maxX, 0, minZ, maxX, 0, maxZ, minX, 0, maxZ);
  indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
}

function sanitizePath(points: Vec2[], start: Vec2, goal: Vec2, appendGoal = true): Vec2[] {
  const filtered: Vec2[] = [];

  for (const point of points) {
    const previous = filtered[filtered.length - 1];
    if (previous && Math.hypot(previous.x - point.x, previous.y - point.y) < 0.02) {
      continue;
    }
    if (Math.hypot(point.x - start.x, point.y - start.y) < 0.08) {
      continue;
    }
    filtered.push(point);
  }

  const tail = filtered[filtered.length - 1];
  if (appendGoal && (!tail || Math.hypot(tail.x - goal.x, tail.y - goal.y) > 0.08)) {
    filtered.push(goal);
  }

  return filtered;
}

export async function createNavigation(config: NavigationConfig): Promise<NavigationApi> {
  const recastCore = await import("@recast-navigation/core/dist/index.mjs");
  const recastGenerators = await import("@recast-navigation/generators/dist/index.mjs");
  const { Crowd, NavMeshQuery, init: initRecast } = recastCore as {
    Crowd: new (navMesh: unknown, params: { maxAgents: number; maxAgentRadius: number }) => RecastCrowd;
    NavMeshQuery: new (navMesh: unknown) => {
      findClosestPoint: (position: { x: number; y: number; z: number }, options: { halfExtents: { x: number; y: number; z: number } }) => {
        success: boolean;
        point: { x: number; y: number; z: number };
      };
      computePath: (
        start: { x: number; y: number; z: number },
        end: { x: number; y: number; z: number },
        options: { halfExtents: { x: number; y: number; z: number }; maxStraightPathPoints: number }
      ) => { success: boolean; path: Array<{ x: number; y: number; z: number }> };
    };
    init: () => Promise<void>;
  };
  const { generateSoloNavMesh } = recastGenerators as {
    generateSoloNavMesh: (
      positions: ArrayLike<number>,
      indices: ArrayLike<number>,
      config: Record<string, unknown>
    ) => { success: boolean; navMesh?: unknown; error?: string };
  };

  await initRecast();

  const positions: number[] = [];
  const indices: number[] = [];
  const roadCells = new Set<string>();
  const padding = Math.max(config.roadMajorHalfWidth, config.roadMinorHalfWidth) + 1;

  for (let x = config.gridMin; x <= config.gridMax; x += config.roadMinorSpacing) {
    const major = distanceToGridLine(x, config.roadMajorSpacing) <= config.roadMajorHalfWidth;
    const halfWidth = major ? config.roadMajorHalfWidth : config.roadMinorHalfWidth;
    pushQuad(positions, indices, x - halfWidth, config.gridMin - padding, x + halfWidth, config.gridMax + padding);
  }

  for (let y = config.gridMin; y <= config.gridMax; y += config.roadMinorSpacing) {
    const major = distanceToGridLine(y, config.roadMajorSpacing) <= config.roadMajorHalfWidth;
    const halfWidth = major ? config.roadMajorHalfWidth : config.roadMinorHalfWidth;
    pushQuad(positions, indices, config.gridMin - padding, y - halfWidth, config.gridMax + padding, y + halfWidth);
  }

  for (let x = config.gridMin; x <= config.gridMax; x += config.gridStep) {
    for (let y = config.gridMin; y <= config.gridMax; y += config.gridStep) {
      const onMajorRoad =
        distanceToGridLine(x, config.roadMajorSpacing) <= config.roadMajorHalfWidth ||
        distanceToGridLine(y, config.roadMajorSpacing) <= config.roadMajorHalfWidth;
      const onMinorRoad =
        distanceToGridLine(x, config.roadMinorSpacing) <= config.roadMinorHalfWidth ||
        distanceToGridLine(y, config.roadMinorSpacing) <= config.roadMinorHalfWidth;

      if (onMajorRoad || onMinorRoad) {
        roadCells.add(keyForCell({ x, y }));
      }
    }
  }

  const navMeshResult = generateSoloNavMesh(positions, indices, {
    cs: 0.2,
    ch: 0.2,
    walkableSlopeAngle: 45,
    walkableHeight: 2,
    walkableClimb: 0.45,
    walkableRadius: 0.45,
    maxEdgeLen: 32,
    maxSimplificationError: 1.1,
    minRegionArea: 4,
    mergeRegionArea: 12,
    maxVertsPerPoly: 6,
    detailSampleDist: 1,
    detailSampleMaxError: 0.1,
    bounds: [
      [config.gridMin - padding, -1, config.gridMin - padding],
      [config.gridMax + padding, 1, config.gridMax + padding]
    ]
  });

  if (!navMeshResult.success || !navMeshResult.navMesh) {
    throw new Error(`Failed to build road navmesh: ${"error" in navMeshResult ? navMeshResult.error : "unknown error"}`);
  }

  const navMesh = navMeshResult.navMesh;
  const navMeshQuery = new NavMeshQuery(navMesh);
  const crowd = new Crowd(navMesh, { maxAgents: 96, maxAgentRadius: 1.1 });
  const crowdAgents = new Map<string, RecastCrowdAgent>();
  const requestedTargets = new Map<string, Vec2>();

  function fallbackWalkable(point: Vec2): Vec2 {
    const x = clamp(Math.round(point.x / config.gridStep) * config.gridStep, config.gridMin, config.gridMax);
    const y = clamp(Math.round(point.y / config.gridStep) * config.gridStep, config.gridMin, config.gridMax);

    if (roadCells.has(keyForCell({ x, y }))) {
      return {
        x: distanceToGridLine(x, config.roadMinorSpacing) <= config.roadMinorHalfWidth ? nearestGridLine(x, config.roadMinorSpacing) : x,
        y: distanceToGridLine(y, config.roadMinorSpacing) <= config.roadMinorHalfWidth ? nearestGridLine(y, config.roadMinorSpacing) : y
      };
    }

    for (let radius = 1; radius <= 8; radius += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        for (let dy = -radius; dy <= radius; dy += 1) {
          const candidate = { x: x + dx, y: y + dy };
          if (roadCells.has(keyForCell(candidate))) {
            return candidate;
          }
        }
      }
    }

    return { x: 0, y: 0 };
  }

  function ensureWalkable(point: Vec2): Vec2 {
    const closest = navMeshQuery.findClosestPoint(toVector3(point), { halfExtents: QUERY_HALF_EXTENTS });
    if (closest.success) {
      return fromVector3(closest.point);
    }

    return fallbackWalkable(point);
  }

  function planPath(start: Vec2, goal: Vec2): Vec2[] {
    const safeStart = ensureWalkable(start);
    const safeGoal = ensureWalkable(goal);
    const result = navMeshQuery.computePath(toVector3(safeStart), toVector3(safeGoal), {
      halfExtents: QUERY_HALF_EXTENTS,
      maxStraightPathPoints: 64
    });

    if (!result.success || result.path.length === 0) {
      return [safeGoal];
    }

    return sanitizePath(result.path.map(fromVector3), safeStart, safeGoal, true);
  }

  function registerCrowdAgent(id: string, position: Vec2, crowdConfig: CrowdAgentConfig = {}): Vec2 {
    const safePosition = ensureWalkable(position);

    const existing = crowdAgents.get(id);
    if (existing) {
      existing.teleport(toVector3(safePosition));
      requestedTargets.set(id, safePosition);
      return safePosition;
    }

    const agent = crowd.addAgent(toVector3(safePosition), {
      radius: crowdConfig.radius ?? 0.42,
      height: crowdConfig.height ?? 1.1,
      maxAcceleration: crowdConfig.maxAcceleration ?? 8,
      maxSpeed: crowdConfig.maxSpeed ?? 2.6,
      collisionQueryRange: crowdConfig.collisionQueryRange ?? 1.8,
      pathOptimizationRange: crowdConfig.pathOptimizationRange ?? 6,
      separationWeight: crowdConfig.separationWeight ?? 1.4
    });

    crowdAgents.set(id, agent);
    requestedTargets.set(id, safePosition);
    return safePosition;
  }

  function removeCrowdAgent(id: string): void {
    const agent = crowdAgents.get(id);
    if (!agent) {
      return;
    }
    crowd.removeAgent(agent);
    crowdAgents.delete(id);
    requestedTargets.delete(id);
  }

  function setCrowdAgentTarget(id: string, target: Vec2): Vec2[] {
    const agent = crowdAgents.get(id);
    const safeTarget = ensureWalkable(target);
    if (!agent) {
      return [safeTarget];
    }

    requestedTargets.set(id, safeTarget);
    agent.requestMoveTarget(toVector3(safeTarget));
    return planPath(fromVector3(agent.position()), safeTarget);
  }

  function resetCrowdAgentTarget(id: string): void {
    const agent = crowdAgents.get(id);
    if (!agent) {
      return;
    }
    requestedTargets.set(id, fromVector3(agent.position()));
    agent.resetMoveTarget();
  }

  function stepCrowd(deltaSeconds: number): void {
    crowd.update(deltaSeconds);
  }

  function syncCrowdAgent(id: string): CrowdAgentSnapshot | null {
    const agent = crowdAgents.get(id);
    if (!agent) {
      return null;
    }

    const position = fromVector3(agent.position());
    const velocity = fromVector3(agent.velocity());
    const corners = agent.corners().map(fromVector3);
    const target = requestedTargets.get(id) ?? fromVector3(agent.target());

    return {
      position,
      velocity,
      path: sanitizePath(corners, position, target, false),
      target
    };
  }

  function distance(a: Vec2, b: Vec2): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  return {
    ensureWalkable,
    planPath,
    distance,
    registerCrowdAgent,
    removeCrowdAgent,
    setCrowdAgentTarget,
    resetCrowdAgentTarget,
    stepCrowd,
    syncCrowdAgent
  };
}
