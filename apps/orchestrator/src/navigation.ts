import type { Vec2 } from "@trust-city/shared";

interface GridPoint {
  x: number;
  y: number;
}

interface QueueNode {
  cell: GridPoint;
  f: number;
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

export interface NavigationApi {
  ensureWalkable: (point: Vec2) => Vec2;
  planPath: (start: Vec2, goal: Vec2) => Vec2[];
  distance: (a: Vec2, b: Vec2) => number;
}

function keyForCell(cell: GridPoint): string {
  return `${cell.x},${cell.y}`;
}

function direction(a: Vec2, b: Vec2): Vec2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  return { x: dx / len, y: dy / len };
}

function simplifyPath(points: Vec2[]): Vec2[] {
  if (points.length <= 2) {
    return points;
  }

  const compressed: Vec2[] = [points[0]];
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = compressed[compressed.length - 1];
    const current = points[i];
    const next = points[i + 1];
    const d1 = direction(prev, current);
    const d2 = direction(current, next);
    const aligned = Math.abs(d1.x - d2.x) < 0.01 && Math.abs(d1.y - d2.y) < 0.01;
    if (!aligned) {
      compressed.push(current);
    }
  }
  compressed.push(points[points.length - 1]);
  return compressed;
}

export function createNavigation(config: NavigationConfig): NavigationApi {
  function clampToGrid(point: Vec2): GridPoint {
    return {
      x: Math.max(config.gridMin, Math.min(config.gridMax, Math.round(point.x / config.gridStep) * config.gridStep)),
      y: Math.max(config.gridMin, Math.min(config.gridMax, Math.round(point.y / config.gridStep) * config.gridStep))
    };
  }

  function distanceToGridLine(value: number, spacing: number): number {
    const mod = ((value % spacing) + spacing) % spacing;
    return Math.min(mod, spacing - mod);
  }

  function nearestGridLine(value: number, spacing: number): number {
    return Math.round(value / spacing) * spacing;
  }

  function isRoadCell(cell: GridPoint): boolean {
    const majorRoad =
      distanceToGridLine(cell.x, config.roadMajorSpacing) <= config.roadMajorHalfWidth ||
      distanceToGridLine(cell.y, config.roadMajorSpacing) <= config.roadMajorHalfWidth;
    if (majorRoad) {
      return true;
    }

    const minorRoad =
      distanceToGridLine(cell.x, config.roadMinorSpacing) <= config.roadMinorHalfWidth ||
      distanceToGridLine(cell.y, config.roadMinorSpacing) <= config.roadMinorHalfWidth;
    return minorRoad;
  }

  function isBlockedCell(cell: GridPoint): boolean {
    if (cell.x < config.gridMin || cell.x > config.gridMax || cell.y < config.gridMin || cell.y > config.gridMax) {
      return true;
    }
    return !isRoadCell(cell);
  }

  function movementCost(cell: GridPoint): number {
    return isRoadCell(cell) ? 1 : 1.45;
  }

  function heuristic(a: GridPoint, b: GridPoint): number {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  function neighborCells(cell: GridPoint): GridPoint[] {
    return [
      { x: cell.x + config.gridStep, y: cell.y },
      { x: cell.x - config.gridStep, y: cell.y },
      { x: cell.x, y: cell.y + config.gridStep },
      { x: cell.x, y: cell.y - config.gridStep }
    ];
  }

  function cellToVec2(cell: GridPoint): Vec2 {
    return { x: cell.x, y: cell.y };
  }

  function snapToRoadCenter(cell: GridPoint): GridPoint {
    const snapped = { ...cell };
    const nearestMinorX = nearestGridLine(cell.x, config.roadMinorSpacing);
    const nearestMinorY = nearestGridLine(cell.y, config.roadMinorSpacing);

    if (Math.abs(cell.x - nearestMinorX) <= config.roadMinorHalfWidth) {
      snapped.x = nearestMinorX;
    }

    if (Math.abs(cell.y - nearestMinorY) <= config.roadMinorHalfWidth) {
      snapped.y = nearestMinorY;
    }

    return snapped;
  }

  function ensureWalkable(point: Vec2): Vec2 {
    const start = clampToGrid(point);
    if (!isBlockedCell(start)) {
      return cellToVec2(snapToRoadCenter(start));
    }

    for (let radius = 1; radius <= 6; radius += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        for (let dy = -radius; dy <= radius; dy += 1) {
          const candidate: GridPoint = { x: start.x + dx, y: start.y + dy };
          if (!isBlockedCell(candidate)) {
            return cellToVec2(snapToRoadCenter(candidate));
          }
        }
      }
    }

    return { x: 0, y: 0 };
  }

  function reconstructPath(cameFrom: Map<string, GridPoint>, current: GridPoint): Vec2[] {
    const path: GridPoint[] = [current];
    let pointer = current;

    while (cameFrom.has(keyForCell(pointer))) {
      pointer = cameFrom.get(keyForCell(pointer))!;
      path.push(pointer);
    }

    path.reverse();
    return path.map(cellToVec2);
  }

  function planPath(start: Vec2, goal: Vec2): Vec2[] {
    const origin = snapToRoadCenter(clampToGrid(ensureWalkable(start)));
    const target = snapToRoadCenter(clampToGrid(ensureWalkable(goal)));

    if (origin.x === target.x && origin.y === target.y) {
      return [goal];
    }

    const openSet: QueueNode[] = [{ cell: origin, f: heuristic(origin, target) }];
    const cameFrom = new Map<string, GridPoint>();
    const gScore = new Map<string, number>([[keyForCell(origin), 0]]);
    const closedSet = new Set<string>();

    while (openSet.length > 0) {
      openSet.sort((a, b) => a.f - b.f);
      const current = openSet.shift()!.cell;
      const currentKey = keyForCell(current);

      if (current.x === target.x && current.y === target.y) {
        const result = reconstructPath(cameFrom, current);
        if (result.length > 1) {
          result.shift();
        }
        result.push(goal);
        return simplifyPath(result);
      }

      closedSet.add(currentKey);

      for (const neighbor of neighborCells(current)) {
        const neighborKey = keyForCell(neighbor);
        if (closedSet.has(neighborKey) || isBlockedCell(neighbor)) {
          continue;
        }

        const tentative = (gScore.get(currentKey) ?? Number.POSITIVE_INFINITY) + movementCost(neighbor);
        if (tentative >= (gScore.get(neighborKey) ?? Number.POSITIVE_INFINITY)) {
          continue;
        }

        cameFrom.set(neighborKey, current);
        gScore.set(neighborKey, tentative);
        const f = tentative + heuristic(neighbor, target);

        const inOpen = openSet.find((node) => node.cell.x === neighbor.x && node.cell.y === neighbor.y);
        if (inOpen) {
          inOpen.f = f;
        } else {
          openSet.push({ cell: neighbor, f });
        }
      }
    }

    return simplifyPath([start, goal]);
  }

  function distance(a: Vec2, b: Vec2): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  return {
    ensureWalkable,
    planPath,
    distance
  };
}
