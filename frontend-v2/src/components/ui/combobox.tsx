// Persona-neutral searchable dropdown primitive.
//
// Three components ship together:
//   <Combobox>          single-select, optional grouping
//   <MultiCombobox>     multi-select chips + same picker
//   <AsyncCombobox>     debounced server-side q= search
//
// All three share keyboard handling (cmdk), filter-as-you-type, and the
// grouped item shape. No persona branching anywhere - this atom is used by
// Carrier, OO, Shipper, Driver, and Admin screens equally.

import * as React from "react";
import { Check, ChevronsUpDown, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

export interface ComboboxItem {
  value: string;
  label: string;
  group?: string;     // section heading; items with the same group cluster together
  hint?: string;      // shown right-aligned in the row (e.g., a code or category)
  disabled?: boolean;
}

/* ─────────────────────────── shared internals ─────────────────────────── */

function groupItems(items: ComboboxItem[]): { name: string; items: ComboboxItem[] }[] {
  if (!items.some(i => i.group)) return [{ name: "", items }];
  const map = new Map<string, ComboboxItem[]>();
  for (const i of items) {
    const k = i.group ?? "";
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(i);
  }
  return [...map.entries()].map(([name, items]) => ({ name, items }));
}

interface PickerBodyProps {
  items: ComboboxItem[];
  selected: Set<string>;
  multi: boolean;
  onToggle: (value: string) => void;
  emptyText: string;
  placeholder: string;
  loading?: boolean;
  query?: string;
  onQueryChange?: (q: string) => void;
}

const PickerBody: React.FC<PickerBodyProps> = ({
  items, selected, multi, onToggle, emptyText, placeholder, loading, query, onQueryChange,
}) => {
  const groups = React.useMemo(() => groupItems(items), [items]);
  const isControlled = onQueryChange !== undefined;

  return (
    <Command shouldFilter={!isControlled}>
      <CommandInput
        placeholder={placeholder}
        value={isControlled ? query : undefined}
        onValueChange={isControlled ? onQueryChange : undefined}
      />
      <CommandList>
        {loading && (
          <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
          </div>
        )}
        {!loading && <CommandEmpty>{emptyText}</CommandEmpty>}
        {!loading && groups.map((g, gi) => (
          <CommandGroup key={gi} heading={g.name || undefined}>
            {g.items.map(item => (
              <CommandItem
                key={item.value}
                value={`${item.label} ${item.value}`}
                disabled={item.disabled}
                onSelect={() => onToggle(item.value)}
                className="flex items-center justify-between gap-2"
              >
                <span className="flex items-center gap-2">
                  <Check className={cn("h-4 w-4", selected.has(item.value) ? "opacity-100" : "opacity-0")} />
                  <span>{item.label}</span>
                </span>
                {item.hint && <span className="text-xs text-muted-foreground">{item.hint}</span>}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </Command>
  );
};

/* ─────────────────────────── single-select ─────────────────────────── */

export interface ComboboxProps {
  items:        ComboboxItem[];
  value:        string | null;
  onChange:     (value: string | null) => void;
  placeholder?: string;
  emptyText?:   string;
  className?:   string;
  disabled?:    boolean;
}

export const Combobox: React.FC<ComboboxProps> = ({
  items, value, onChange, placeholder = "Select…", emptyText = "No results.", className, disabled,
}) => {
  const [open, setOpen] = React.useState(false);
  const sel = items.find(i => i.value === value) ?? null;
  const selected = new Set(value ? [value] : []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("w-full justify-between font-normal", !sel && "text-muted-foreground", className)}
        >
          <span className="truncate">{sel?.label ?? placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <PickerBody
          items={items}
          selected={selected}
          multi={false}
          onToggle={(v) => { onChange(v === value ? null : v); setOpen(false); }}
          emptyText={emptyText}
          placeholder={placeholder}
        />
      </PopoverContent>
    </Popover>
  );
};

/* ─────────────────────────── multi-select ─────────────────────────── */

export interface MultiComboboxProps {
  items:        ComboboxItem[];
  value:        string[];
  onChange:     (value: string[]) => void;
  placeholder?: string;
  emptyText?:   string;
  className?:   string;
  disabled?:    boolean;
  /** Cap how many chips render; the rest collapse into "+N more". */
  maxChips?:    number;
}

export const MultiCombobox: React.FC<MultiComboboxProps> = ({
  items, value, onChange, placeholder = "Select…", emptyText = "No results.", className, disabled, maxChips = 5,
}) => {
  const [open, setOpen] = React.useState(false);
  const selected = new Set(value);
  const selItems = items.filter(i => selected.has(i.value));

  const toggle = (v: string) => {
    if (selected.has(v)) {
      onChange(value.filter(x => x !== v));
    } else {
      onChange([...value, v]);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("w-full justify-between font-normal h-auto min-h-10 py-1.5", !selItems.length && "text-muted-foreground", className)}
        >
          <span className="flex flex-wrap items-center gap-1 text-left">
            {selItems.length === 0 && <span>{placeholder}</span>}
            {selItems.slice(0, maxChips).map(it => (
              <Badge key={it.value} variant="secondary" className="gap-1">
                {it.label}
                <X
                  className="h-3 w-3 cursor-pointer opacity-60 hover:opacity-100"
                  onClick={(e) => { e.stopPropagation(); toggle(it.value); }}
                />
              </Badge>
            ))}
            {selItems.length > maxChips && (
              <Badge variant="outline">+{selItems.length - maxChips} more</Badge>
            )}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <PickerBody
          items={items}
          selected={selected}
          multi={true}
          onToggle={toggle}
          emptyText={emptyText}
          placeholder={placeholder}
        />
      </PopoverContent>
    </Popover>
  );
};

/* ─────────────────────────── async single-select ─────────────────────────── */

export interface AsyncComboboxProps {
  /** Called with the debounced query; should return ComboboxItem[]. */
  fetchItems:   (q: string) => Promise<ComboboxItem[]>;
  /** Selected value + its label (label kept on the parent so we don't have to re-fetch on mount). */
  value:        { value: string; label: string } | null;
  onChange:     (selection: { value: string; label: string } | null) => void;
  placeholder?: string;
  emptyText?:   string;
  className?:   string;
  disabled?:    boolean;
  /** ms - default 200. */
  debounceMs?:  number;
}

export const AsyncCombobox: React.FC<AsyncComboboxProps> = ({
  fetchItems, value, onChange, placeholder = "Search…", emptyText = "No matches.",
  className, disabled, debounceMs = 200,
}) => {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [items, setItems] = React.useState<ComboboxItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  const reqId = React.useRef(0);

  React.useEffect(() => {
    if (!open) return;
    const id = ++reqId.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetchItems(query);
        if (id === reqId.current) setItems(r);
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    }, debounceMs);
    return () => clearTimeout(t);
  }, [query, open, fetchItems, debounceMs]);

  const selected = new Set(value ? [value.value] : []);

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(""); }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("w-full justify-between font-normal", !value && "text-muted-foreground", className)}
        >
          <span className="truncate">{value?.label ?? placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <PickerBody
          items={items}
          selected={selected}
          multi={false}
          onToggle={(v) => {
            const it = items.find(i => i.value === v);
            if (it) { onChange({ value: it.value, label: it.label }); setOpen(false); }
          }}
          emptyText={emptyText}
          placeholder={placeholder}
          loading={loading}
          query={query}
          onQueryChange={setQuery}
        />
      </PopoverContent>
    </Popover>
  );
};
