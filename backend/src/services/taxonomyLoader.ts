// Loads /data/taxonomy/*.json once at startup and serves them through
// memoized getters. The matching engine and the /api/reference/* routes
// both read from here so they're guaranteed to see the same canonical lists.
//
// Path resolution:
//   - prod (after EB unzip): __dirname is dist/services/  →  ../data/taxonomy
//   - dev (ts-node):         __dirname is src/services/   →  ../../data/taxonomy
//                            (the canonical /data/taxonomy at repo root)

import fs from 'fs';
import path from 'path';

function resolveTaxonomyDir(): string {
  const candidates = [
    // 1. prod: dist/services/*  →  dist/data/taxonomy (copy-taxonomy build step)
    path.resolve(__dirname, '..', 'data', 'taxonomy'),
    // 2. dev:  src/services/*   →  repo-root /data/taxonomy
    path.resolve(__dirname, '..', '..', '..', 'data', 'taxonomy'),
    // 3. fallback: cwd-relative for unusual run layouts
    path.resolve(process.cwd(), 'data', 'taxonomy'),
    path.resolve(process.cwd(), '..', 'data', 'taxonomy'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'equipment-classes.json'))) return c;
  }
  throw new Error(
    `Taxonomy data not found. Tried: ${candidates.join(', ')}. ` +
    `Did the backend build step run (npm run copy-taxonomy)?`
  );
}

function load<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(resolveTaxonomyDir(), file), 'utf8')) as T;
}

// --- types ---

export type Triboolean = 'Y' | 'N' | 'opt' | 'n/a';

export interface EquipmentClassAttributes {
  temperature_controlled: Triboolean;
  hazmat_capable:         Triboolean;
  food_grade:             Triboolean;
  liftgate:               Triboolean;
  oversize_capable:       Triboolean;
  team_driver_required:   Triboolean;
  length_ft:              number | null;
}

export interface EquipmentClass {
  code: string;
  name: string;
  type: 'articulated' | 'straight' | 'tractor';
  category: string;
  attributes: EquipmentClassAttributes;
  notes?: string;
}

export interface LoadMode    { code: string; name: string; description: string; }
export interface ServiceType { code: string; name: string; description: string; }

export interface Accessorial { code: string; name: string; category: string; description: string; }

export interface HazmatClass {
  code: string;
  name: string;
  divisions: string[];
  examples: string;
  endorsementRequired: string;
}

export interface Commodity {
  code: string;
  name: string;
  category: string;
  requires?: string[];
  defaultHazmat?: string;
}

export interface CommodityCategory { code: string; name: string; }

// --- memoized accessors ---

let _classes: EquipmentClass[] | null = null;
let _models:  any                     | null = null;
let _modes:   LoadMode[]              | null = null;
let _services: ServiceType[]          | null = null;
let _commodities: { categories: CommodityCategory[]; items: Commodity[] } | null = null;
let _accessorials: Accessorial[]      | null = null;
let _hazmat: HazmatClass[]            | null = null;

export function getEquipmentClasses(): EquipmentClass[] {
  if (!_classes) {
    _classes = load<{ classes: EquipmentClass[] }>('equipment-classes.json').classes;
  }
  return _classes;
}

export function getEquipmentClass(code: string): EquipmentClass | undefined {
  return getEquipmentClasses().find(c => c.code === code);
}

export function getEquipmentModels(): any {
  if (!_models) _models = load('equipment-models.json');
  return _models;
}

/** Returns manufacturer -> models[] for a single class code. */
export function getModelsForClass(classCode: string): Record<string, string[]> {
  const m = getEquipmentModels();
  if (m.trailers && m.trailers[classCode])     return m.trailers[classCode];
  if (m.boxTrucks && m.boxTrucks[classCode])   return m.boxTrucks[classCode];
  if (classCode === 'PO' || classCode === 'POE') return m.powerUnits;
  return {};
}

export function getLoadModes(): LoadMode[] {
  if (!_modes) _modes = load<{ modes: LoadMode[] }>('load-modes.json').modes;
  return _modes;
}

export function getServiceTypes(): ServiceType[] {
  if (!_services) _services = load<{ services: ServiceType[] }>('service-types.json').services;
  return _services;
}

export function getCommodityCategories(): CommodityCategory[] {
  if (!_commodities) loadCommodities();
  return _commodities!.categories;
}

export function getCommodities(): Commodity[] {
  if (!_commodities) loadCommodities();
  return _commodities!.items;
}

function loadCommodities() {
  const d = load<{ categories: CommodityCategory[]; commodities: Commodity[] }>('commodities.json');
  _commodities = { categories: d.categories, items: d.commodities };
}

export function getAccessorials(): Accessorial[] {
  if (!_accessorials) {
    _accessorials = load<{ accessorials: Accessorial[] }>('accessorials.json').accessorials;
  }
  return _accessorials;
}

export function getHazmatClasses(): HazmatClass[] {
  if (!_hazmat) _hazmat = load<{ classes: HazmatClass[] }>('hazmat-classes.json').classes;
  return _hazmat;
}

/** Substring match across name + code. Case-insensitive. */
export function searchCommodities(q: string, limit = 25): Commodity[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return getCommodities().slice(0, limit);
  return getCommodities()
    .filter(c => c.name.toLowerCase().includes(needle) || c.code.toLowerCase().includes(needle))
    .slice(0, limit);
}

/** Search across all models in a class, returning {manufacturer, model} tuples. */
export function searchModels(classCode: string, q: string, limit = 25): { manufacturer: string; model: string }[] {
  const byMfg = getModelsForClass(classCode);
  const needle = q.trim().toLowerCase();
  const all: { manufacturer: string; model: string }[] = [];
  for (const [mfg, models] of Object.entries(byMfg)) {
    for (const model of models) {
      if (!needle || model.toLowerCase().includes(needle) || mfg.toLowerCase().includes(needle)) {
        all.push({ manufacturer: mfg, model });
      }
    }
  }
  return all.slice(0, limit);
}
