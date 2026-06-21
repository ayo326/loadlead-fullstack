// Thin wrappers over /api/reference/* that adapt the responses into the
// ComboboxItem shape used by <Combobox>, <MultiCombobox>, <AsyncCombobox>.
//
// The reference lists are loaded once per page via useTaxonomy<Hook>() and
// memoized; the API client itself stays a single source of truth.

import { useEffect, useState } from "react";

import type { ComboboxItem } from "@/components/ui/combobox";

const BASE = (import.meta.env.VITE_API_URL ?? "") + "/api/reference";

type Resp<T> = { items: T };

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { credentials: "include" });
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status}`);
  return r.json();
}

/* ───────────── raw shapes returned by the API ───────────── */

export interface EquipmentClass {
  code: string;
  name: string;
  type: "articulated" | "straight" | "tractor";
  category: string;
  attributes: {
    temperature_controlled: "Y" | "N" | "opt" | "n/a";
    hazmat_capable:         "Y" | "N" | "opt" | "n/a";
    food_grade:             "Y" | "N" | "opt" | "n/a";
    liftgate:               "Y" | "N" | "opt" | "n/a";
    oversize_capable:       "Y" | "N" | "opt" | "n/a";
    team_driver_required:   "Y" | "N" | "opt" | "n/a";
    length_ft:              number | null;
  };
}

export interface Commodity {
  code: string;
  name: string;
  category: string;
  requires?: string[];
  defaultHazmat?: string;
}

export interface Accessorial { code: string; name: string; category: string; description: string; }
export interface LoadMode    { code: string; name: string; description: string; }
export interface ServiceType { code: string; name: string; description: string; }
export interface HazmatClass { code: string; name: string; divisions: string[]; examples: string; endorsementRequired: string; }

/* ───────────── adapters: shape -> ComboboxItem[] ───────────── */

export function toEquipmentItems(classes: EquipmentClass[]): ComboboxItem[] {
  return classes.map(c => ({
    value: c.code,
    label: c.name,
    group: c.category,
    hint: c.code,
  }));
}

export function toCommodityItems(commodities: Commodity[], categoryNames: Record<string, string>): ComboboxItem[] {
  return commodities.map(c => ({
    value: c.code,
    label: c.name,
    group: categoryNames[c.category] ?? c.category,
    hint: c.code,
  }));
}

export function toAccessorialItems(items: Accessorial[]): ComboboxItem[] {
  return items.map(a => ({ value: a.code, label: a.name, group: a.category }));
}

export function toModeItems(items: LoadMode[]): ComboboxItem[] {
  return items.map(m => ({ value: m.code, label: m.name, hint: m.code }));
}

export function toServiceItems(items: ServiceType[]): ComboboxItem[] {
  return items.map(s => ({ value: s.code, label: s.name, hint: s.code }));
}

export function toHazmatItems(items: HazmatClass[]): ComboboxItem[] {
  return items.map(h => ({ value: h.code, label: `Class ${h.code}: ${h.name}`, hint: h.endorsementRequired }));
}

/* ───────────── one-shot loaders for the small lists ───────────── */

export const taxonomyApi = {
  equipmentClasses: () => get<Resp<EquipmentClass[]>>("/equipment-classes").then(r => r.items),
  loadModes:        () => get<Resp<LoadMode[]>>("/load-modes").then(r => r.items),
  serviceTypes:     () => get<Resp<ServiceType[]>>("/service-types").then(r => r.items),
  accessorials:     () => get<Resp<Accessorial[]>>("/accessorials").then(r => r.items),
  hazmatClasses:    () => get<Resp<HazmatClass[]>>("/hazmat-classes").then(r => r.items),

  /** Returns top N or all matches for q. Limit defaults to 25 server-side. */
  searchCommodities: async (q: string, limit = 25) => {
    const qs = new URLSearchParams({ q, limit: String(limit) }).toString();
    const r = await get<{ categories: { code: string; name: string }[]; items: Commodity[] }>(`/commodities?${qs}`);
    return r;
  },

  searchEquipmentModels: async (classCode: string, q: string, limit = 25) => {
    const qs = new URLSearchParams({ class: classCode, q, limit: String(limit) }).toString();
    return get<{ items: { manufacturer: string; model: string }[] }>(`/equipment-models?${qs}`).then(r => r.items);
  },
};

/* ───────────── tiny memoizing hook (per-page cache) ───────────── */

function useOnce<T>(loader: () => Promise<T>): { data: T | null; loading: boolean; error: Error | null } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    let cancelled = false;
    loader()
      .then(d => { if (!cancelled) setData(d); })
      .catch(e => { if (!cancelled) setError(e); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { data, loading, error };
}

export const useEquipmentClasses = () => useOnce(taxonomyApi.equipmentClasses);
export const useLoadModes        = () => useOnce(taxonomyApi.loadModes);
export const useServiceTypes     = () => useOnce(taxonomyApi.serviceTypes);
export const useAccessorials     = () => useOnce(taxonomyApi.accessorials);
export const useHazmatClasses    = () => useOnce(taxonomyApi.hazmatClasses);
