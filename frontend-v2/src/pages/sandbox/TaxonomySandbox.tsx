// Sandbox page to demonstrate every dropdown variant feeding from
// /api/reference/*. Mounted at /sandbox/taxonomy in dev only.
//
// This page is persona-neutral by construction - it uses the shared
// <Combobox>/<MultiCombobox>/<AsyncCombobox> atoms directly without any
// Carrier/OO branching.

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Combobox, MultiCombobox, AsyncCombobox } from "@/components/ui/combobox";
import {
  useAccessorials,
  useEquipmentClasses,
  useHazmatClasses,
  useLoadModes,
  useServiceTypes,
  taxonomyApi,
  toAccessorialItems,
  toEquipmentItems,
  toHazmatItems,
  toModeItems,
  toServiceItems,
} from "@/services/taxonomy";

export default function TaxonomySandbox() {
  const eq      = useEquipmentClasses();
  const modes   = useLoadModes();
  const service = useServiceTypes();
  const access  = useAccessorials();
  const hazmat  = useHazmatClasses();

  const [equipmentClass, setEquipmentClass] = useState<string | null>(null);
  const [mode, setMode]                     = useState<string | null>(null);
  const [serviceType, setServiceType]       = useState<string | null>(null);
  const [accessorials, setAccessorials]     = useState<string[]>([]);
  const [hazmatClass, setHazmatClass]       = useState<string | null>(null);
  const [commodity, setCommodity]           = useState<{ value: string; label: string } | null>(null);
  const [model, setModel]                   = useState<{ value: string; label: string } | null>(null);

  const equipmentItems   = useMemo(() => eq.data      ? toEquipmentItems(eq.data)        : [], [eq.data]);
  const modeItems        = useMemo(() => modes.data   ? toModeItems(modes.data)          : [], [modes.data]);
  const serviceItems     = useMemo(() => service.data ? toServiceItems(service.data)     : [], [service.data]);
  const accessorialItems = useMemo(() => access.data  ? toAccessorialItems(access.data)  : [], [access.data]);
  const hazmatItems      = useMemo(() => hazmat.data  ? toHazmatItems(hazmat.data)       : [], [hazmat.data]);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Taxonomy dropdown sandbox</h1>
        <p className="text-sm text-muted-foreground">
          Every selector is fed from <code className="rounded bg-muted px-1 py-0.5">/api/reference/*</code>.
          No persona branching - Carrier, OO, Shipper, Driver, and Admin all bind the
          same atoms.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Single-select (grouped)</CardTitle>
          <CardDescription>
            Equipment class - 40 codes grouped by category (van, reefer, flatbed, tanker, …).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="mb-1.5 block">Equipment class</Label>
            <Combobox
              items={equipmentItems}
              value={equipmentClass}
              onChange={setEquipmentClass}
              placeholder="Select an equipment class…"
            />
            {equipmentClass && (
              <p className="mt-2 text-xs text-muted-foreground">selected: <code>{equipmentClass}</code></p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="mb-1.5 block">Load mode</Label>
              <Combobox items={modeItems} value={mode} onChange={setMode} placeholder="Mode…" />
            </div>
            <div>
              <Label className="mb-1.5 block">Service type</Label>
              <Combobox items={serviceItems} value={serviceType} onChange={setServiceType} placeholder="Service…" />
            </div>
          </div>

          <div>
            <Label className="mb-1.5 block">Hazmat class (when applicable)</Label>
            <Combobox items={hazmatItems} value={hazmatClass} onChange={setHazmatClass} placeholder="Hazmat class…" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Multi-select (chips)</CardTitle>
          <CardDescription>Accessorials - grouped by category, multi-selectable with chip removal.</CardDescription>
        </CardHeader>
        <CardContent>
          <Label className="mb-1.5 block">Accessorials</Label>
          <MultiCombobox
            items={accessorialItems}
            value={accessorials}
            onChange={setAccessorials}
            placeholder="Add accessorials…"
          />
          <p className="mt-2 text-xs text-muted-foreground">
            selected: <code>[{accessorials.join(", ")}]</code>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Async single-select (debounced server search)</CardTitle>
          <CardDescription>
            Commodity - 104 items, server hits <code>/api/reference/commodities?q=…</code>.
            Try typing "frozen", "fuel", or "steel".
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="mb-1.5 block">Commodity</Label>
            <AsyncCombobox
              value={commodity}
              onChange={setCommodity}
              placeholder="Search commodities…"
              fetchItems={async (q) => {
                const r = await taxonomyApi.searchCommodities(q || "", 25);
                const catNames = Object.fromEntries(r.categories.map(c => [c.code, c.name]));
                return r.items.map(c => ({
                  value: c.code,
                  label: c.name,
                  group: catNames[c.category] ?? c.category,
                  hint:  c.code,
                }));
              }}
            />
            {commodity && (
              <p className="mt-2 text-xs text-muted-foreground">selected: <code>{commodity.value}</code> - {commodity.label}</p>
            )}
          </div>

          <div>
            <Label className="mb-1.5 block">
              Equipment model (depends on selected class)
            </Label>
            <AsyncCombobox
              value={model}
              onChange={setModel}
              disabled={!equipmentClass}
              placeholder={equipmentClass ? "Search models…" : "Pick an equipment class first"}
              fetchItems={async (q) => {
                if (!equipmentClass) return [];
                const items = await taxonomyApi.searchEquipmentModels(equipmentClass, q || "", 25);
                return items.map(it => ({
                  value: `${it.manufacturer}::${it.model}`,
                  label: it.model,
                  group: it.manufacturer,
                }));
              }}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Selection summary</CardTitle>
          <CardDescription>The shape a load form would post to the backend.</CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="rounded bg-muted p-3 text-xs">
{JSON.stringify({
  equipment_required: equipmentClass,
  mode,
  service_type: serviceType,
  characteristics: { hazmat_class: hazmatClass },
  commodity: commodity?.value ?? null,
  accessorials,
  equipment_model: model?.value ?? null,
}, null, 2)}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
