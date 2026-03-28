import { ROLE_HUBS, type District, type Vec2 } from "@trust-city/shared";

export type StructureKind = "tower" | "midrise" | "house" | "warehouse" | "institution" | "park" | "tree";

export interface CityStructure {
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  hue: number;
  kind: StructureKind;
  districtTheme: District["theme"];
  lod: "near" | "far";
}

export interface RoadLine {
  axis: "h" | "v";
  x: number;
  z: number;
  length: number;
  kind: "major" | "minor";
  width: number;
}

export interface StreamedCity {
  near: CityStructure[];
  far: CityStructure[];
  roads: RoadLine[];
}

export const CHUNK_SIZE = 48;
export const ROAD_MINOR_SPACING = 12;

const LOT_SIZE = 6;
const ROAD_MAJOR_SPACING = 24;
const ROAD_MAJOR_HALF_WIDTH = 2.8;
const ROAD_MINOR_HALF_WIDTH = 1.7;
const NEAR_CHUNK_RADIUS = 2;
const FAR_CHUNK_RADIUS = 4;
const BUILDING_SETBACK = 0.95;
const HUB_CLEARANCE_RADIUS = 8.5;

function distanceSq(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function isProtectedZone(position: Vec2, districts: District[]): boolean {
  for (const hub of Object.values(ROLE_HUBS)) {
    if (distanceSq(position, hub.position) <= HUB_CLEARANCE_RADIUS * HUB_CLEARANCE_RADIUS) {
      return true;
    }
  }

  for (const district of districts) {
    const protectedRadius = Math.max(6.2, district.radius * 0.48);
    if (distanceSq(position, district.center) <= protectedRadius * protectedRadius) {
      return true;
    }
  }

  return false;
}

function hashNumber(seed: number, x: number, y: number): number {
  let value = (seed ^ (x * 374761393) ^ (y * 668265263)) >>> 0;
  value = (value ^ (value >> 13)) >>> 0;
  value = (Math.imul(value, 1274126177) ^ (value >> 16)) >>> 0;
  return value / 4294967295;
}

function distanceToGridLine(value: number, spacing: number): number {
  const mod = ((value % spacing) + spacing) % spacing;
  return Math.min(mod, spacing - mod);
}

function roadTypeAt(value: number, extraClearance = 0): "major" | "minor" | "none" {
  if (distanceToGridLine(value, ROAD_MAJOR_SPACING) <= ROAD_MAJOR_HALF_WIDTH + extraClearance) {
    return "major";
  }
  if (distanceToGridLine(value, ROAD_MINOR_SPACING) <= ROAD_MINOR_HALF_WIDTH + extraClearance) {
    return "minor";
  }
  return "none";
}

function nearestDistrictTheme(position: Vec2, districts: District[]): District["theme"] {
  if (districts.length === 0) {
    return "core";
  }

  let best: District | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const district of districts) {
    const dx = district.center.x - position.x;
    const dz = district.center.y - position.y;
    const distanceSq = dx * dx + dz * dz;
    if (distanceSq < bestDistance) {
      bestDistance = distanceSq;
      best = district;
    }
  }

  return best?.theme ?? "core";
}

function districtHue(theme: District["theme"]): number {
  if (theme === "core") {
    return 198;
  }
  if (theme === "industrial") {
    return 28;
  }
  if (theme === "research") {
    return 222;
  }
  return 122;
}

function pickStructureKind(
  theme: District["theme"],
  selectionRoll: number,
  greeneryRoll: number,
  occupancyRoll: number,
  lod: "near" | "far"
): StructureKind | null {
  const occupancyByTheme: Record<District["theme"], number> = {
    core: lod === "near" ? 0.52 : 0.22,
    industrial: lod === "near" ? 0.44 : 0.2,
    research: lod === "near" ? 0.4 : 0.18,
    residential: lod === "near" ? 0.34 : 0.15
  };

  if (occupancyRoll > occupancyByTheme[theme]) {
    return null;
  }

  const parkChanceByTheme: Record<District["theme"], number> = {
    core: 0.05,
    industrial: 0.07,
    research: 0.14,
    residential: 0.22
  };

  if (greeneryRoll < parkChanceByTheme[theme]) {
    return greeneryRoll < parkChanceByTheme[theme] * 0.45 ? "tree" : "park";
  }

  if (theme === "core") {
    if (selectionRoll < 0.5) {
      return "tower";
    }
    if (selectionRoll < 0.83) {
      return "midrise";
    }
    return "institution";
  }

  if (theme === "industrial") {
    if (selectionRoll < 0.54) {
      return "warehouse";
    }
    if (selectionRoll < 0.78) {
      return "midrise";
    }
    return "institution";
  }

  if (theme === "research") {
    if (selectionRoll < 0.46) {
      return "institution";
    }
    if (selectionRoll < 0.72) {
      return "midrise";
    }
    return "tower";
  }

  if (selectionRoll < 0.56) {
    return "house";
  }
  if (selectionRoll < 0.82) {
    return "midrise";
  }
  return "institution";
}

function buildChunkStructures(seed: number, cx: number, cz: number, lod: "near" | "far", districts: District[]): CityStructure[] {
  const chunkMinX = cx * CHUNK_SIZE - CHUNK_SIZE / 2;
  const chunkMinZ = cz * CHUNK_SIZE - CHUNK_SIZE / 2;
  const lotsPerSide = Math.floor(CHUNK_SIZE / LOT_SIZE);
  const output: CityStructure[] = [];

  for (let lz = 0; lz < lotsPerSide; lz += 1) {
    for (let lx = 0; lx < lotsPerSide; lx += 1) {
      const x = chunkMinX + lx * LOT_SIZE + LOT_SIZE / 2;
      const z = chunkMinZ + lz * LOT_SIZE + LOT_SIZE / 2;
      const position = { x, y: z };

      if (roadTypeAt(x, BUILDING_SETBACK) !== "none" || roadTypeAt(z, BUILDING_SETBACK) !== "none" || isProtectedZone(position, districts)) {
        continue;
      }

      const theme = nearestDistrictTheme(position, districts);
      const occupancyRoll = hashNumber(seed + 5, cx * 53 + lx * 11, cz * 71 + lz * 17);
      const selectionRoll = hashNumber(seed + 17, cx * 83 + lx * 31, cz * 37 + lz * 13);
      const greeneryRoll = hashNumber(seed + 31, cx * 29 + lx * 7, cz * 97 + lz * 19);
      const scaleRoll = hashNumber(seed + 47, cx * 107 + lx * 23, cz * 43 + lz * 27);

      const kind = pickStructureKind(theme, selectionRoll, greeneryRoll, occupancyRoll, lod);
      if (!kind) {
        continue;
      }

      let width = 2.5;
      let depth = 2.5;
      let height = 3.5;

      if (kind === "tower") {
        width = 2.4 + scaleRoll * 1.8;
        depth = 2.4 + (1 - scaleRoll) * 1.6;
        height = (lod === "near" ? 14 : 8) + scaleRoll * (lod === "near" ? 20 : 10);
      } else if (kind === "midrise") {
        width = 2.6 + scaleRoll * 1.6;
        depth = 2.4 + (1 - scaleRoll) * 1.4;
        height = (lod === "near" ? 6.5 : 4.2) + scaleRoll * (lod === "near" ? 7.5 : 4.5);
      } else if (kind === "house") {
        width = 2.2 + scaleRoll * 1.2;
        depth = 2 + (1 - scaleRoll) * 1.4;
        height = (lod === "near" ? 1.5 : 1.2) + scaleRoll * (lod === "near" ? 1.3 : 0.8);
      } else if (kind === "warehouse") {
        width = 3.6 + scaleRoll * 1.9;
        depth = 3.2 + (1 - scaleRoll) * 1.7;
        height = (lod === "near" ? 2.8 : 2.1) + scaleRoll * (lod === "near" ? 2.6 : 1.2);
      } else if (kind === "institution") {
        width = 3.2 + scaleRoll * 1.5;
        depth = 3 + (1 - scaleRoll) * 1.5;
        height = (lod === "near" ? 4.5 : 3.1) + scaleRoll * (lod === "near" ? 4.1 : 2.4);
      } else if (kind === "park") {
        width = 4.2 + scaleRoll * 1.5;
        depth = 4 + (1 - scaleRoll) * 1.6;
        height = 0.12;
      } else if (kind === "tree") {
        width = 0.45;
        depth = 0.45;
        height = 1.9 + scaleRoll * 2.4;
      }

      output.push({
        x,
        z,
        width,
        depth,
        height,
        hue: districtHue(theme) + Math.floor((scaleRoll - 0.5) * 18),
        kind,
        districtTheme: theme,
        lod
      });
    }
  }

  return output;
}

export function buildStreamedCity(seed: number, focusPoint: Vec2, districts: District[]): StreamedCity {
  const focusChunkX = Math.round(focusPoint.x / CHUNK_SIZE);
  const focusChunkZ = Math.round(focusPoint.y / CHUNK_SIZE);

  const near: CityStructure[] = [];
  const far: CityStructure[] = [];

  for (let dz = -FAR_CHUNK_RADIUS; dz <= FAR_CHUNK_RADIUS; dz += 1) {
    for (let dx = -FAR_CHUNK_RADIUS; dx <= FAR_CHUNK_RADIUS; dx += 1) {
      const cx = focusChunkX + dx;
      const cz = focusChunkZ + dz;
      const dist = Math.max(Math.abs(dx), Math.abs(dz));

      if (dist <= NEAR_CHUNK_RADIUS) {
        near.push(...buildChunkStructures(seed, cx, cz, "near", districts));
      } else {
        far.push(...buildChunkStructures(seed, cx, cz, "far", districts));
      }
    }
  }

  const minChunkX = focusChunkX - FAR_CHUNK_RADIUS - 1;
  const maxChunkX = focusChunkX + FAR_CHUNK_RADIUS + 1;
  const minChunkZ = focusChunkZ - FAR_CHUNK_RADIUS - 1;
  const maxChunkZ = focusChunkZ + FAR_CHUNK_RADIUS + 1;
  const minX = (minChunkX - 0.5) * CHUNK_SIZE;
  const maxX = (maxChunkX + 0.5) * CHUNK_SIZE;
  const minZ = (minChunkZ - 0.5) * CHUNK_SIZE;
  const maxZ = (maxChunkZ + 0.5) * CHUNK_SIZE;
  const roads: RoadLine[] = [];

  const xStart = Math.floor(minX / ROAD_MINOR_SPACING) * ROAD_MINOR_SPACING;
  const zStart = Math.floor(minZ / ROAD_MINOR_SPACING) * ROAD_MINOR_SPACING;

  for (let x = xStart; x <= maxX; x += ROAD_MINOR_SPACING) {
    const kind = roadTypeAt(x) === "major" ? "major" : "minor";
    roads.push({
      axis: "v",
      x,
      z: (minZ + maxZ) * 0.5,
      length: maxZ - minZ,
      kind,
      width: kind === "major" ? ROAD_MAJOR_HALF_WIDTH * 2 : ROAD_MINOR_HALF_WIDTH * 2
    });
  }

  for (let z = zStart; z <= maxZ; z += ROAD_MINOR_SPACING) {
    const kind = roadTypeAt(z) === "major" ? "major" : "minor";
    roads.push({
      axis: "h",
      x: (minX + maxX) * 0.5,
      z,
      length: maxX - minX,
      kind,
      width: kind === "major" ? ROAD_MAJOR_HALF_WIDTH * 2 : ROAD_MINOR_HALF_WIDTH * 2
    });
  }

  return { near, far, roads };
}
