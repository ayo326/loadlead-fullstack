# LoadLead — Modern UI (Convoy-blue)

Drop-in React + Vite + Tailwind + shadcn/ui frontend for LoadLead.
Routes: `/` landing · `/login` · `/driver` · `/shipper` · `/shipper/post` · `/receiver` · `/admin`.

## For Claude Code
Tell Claude Code:
> "Use this `src/` as my LoadLead frontend. Replace the existing `frontend/src/`, keep my existing API client, and wire the dashboards to `NEXT_PUBLIC_API_URL=http://localhost:4000/api`. Currently dashboards read from `src/lib/mockData.ts` — replace those imports with real fetch calls to `/api/driver/offers`, `/api/shipper/loads`, `/api/receiver/shipments`, `/api/admin/*`."

## Run
```bash
npm install
npm run dev
```
