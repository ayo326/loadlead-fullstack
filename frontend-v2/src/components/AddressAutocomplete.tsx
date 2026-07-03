import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { MapPin } from "lucide-react";
import { api } from "@/lib/api";

export interface AddressParts {
  street: string;
  city: string;
  state: string;
  zip: string;
}

/**
 * Street-address input with live Google Places suggestions (proxied through the
 * backend). Typing queries /api/maps/autocomplete (debounced); picking a
 * suggestion resolves the full address via /api/maps/place and calls onSelect so
 * the caller can fill city/state/zip too. If Places is unavailable the dropdown
 * simply never appears and manual entry still works.
 */
export function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder,
  required,
}: {
  value: string;
  onChange: (street: string) => void;
  onSelect: (parts: AddressParts) => void;
  placeholder?: string;
  required?: boolean;
}) {
  const [suggestions, setSuggestions] = useState<{ description: string; placeId: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);
  const skipNext = useRef(false);

  useEffect(() => {
    // Don't re-query right after a selection filled the field.
    if (skipNext.current) { skipNext.current = false; return; }
    const q = value.trim();
    if (q.length < 3) { setSuggestions([]); setOpen(false); return; }
    const t = setTimeout(async () => {
      try {
        const { suggestions } = await api.addressAutocomplete(q);
        setSuggestions(suggestions);
        setOpen(suggestions.length > 0);
        setActive(-1);
      } catch { setSuggestions([]); setOpen(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [value]);

  // Close on outside click.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  async function choose(placeId: string, description: string) {
    setOpen(false);
    skipNext.current = true;
    try {
      const parts = await api.addressPlace(placeId);
      onSelect({ street: parts.street || description, city: parts.city, state: parts.state, zip: parts.zip });
    } catch {
      onChange(description); // fall back to the raw text
    }
  }

  return (
    <div className="relative" ref={boxRef}>
      <Input
        placeholder={placeholder}
        value={value}
        required={required}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => { if (suggestions.length) setOpen(true); }}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, suggestions.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === "Enter" && active >= 0) { e.preventDefault(); const s = suggestions[active]; choose(s.placeId, s.description); }
          else if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && suggestions.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md">
          {suggestions.map((s, i) => (
            <li key={s.placeId}>
              <button
                type="button"
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${i === active ? "bg-accent" : "hover:bg-accent"}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(s.placeId, s.description)}
              >
                <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{s.description}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
