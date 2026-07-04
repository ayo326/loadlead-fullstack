import { Link } from "react-router-dom";
import { useState, useEffect } from "react";
import { ArrowRight, Briefcase, Building2, CheckCircle2, Clock, Gauge, MapPin, PackageCheck, Radio, ShieldCheck, ShipWheel, Truck, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { StagingEnvToggle } from "@/components/StagingEnvToggle";

const API = (import.meta.env.VITE_API_URL ?? "https://api.loadleadapp.com") + "/api";

export default function Landing() {
  return (
    <div className="font-display-hangar min-h-screen bg-background text-foreground">
      {/* Engineering-only staging start/pause control (renders only in the staging build) */}
      <StagingEnvToggle />
      {/* Nav */}
      <header className="cx-nav absolute top-0 inset-x-0 z-20">
        <div className="max-w-7xl mx-auto flex items-center justify-between px-6 py-5">
          <div className="text-primary-foreground">
            <Logo variant="light" height={44} />
          </div>
          <nav className="hidden md:flex items-center gap-8 text-sm text-primary-foreground/80">
            <a href="#how" className="hover:text-primary-foreground">How it works</a>
            <a href="#roles" className="hover:text-primary-foreground">For your team</a>
            <a href="#metrics" className="hover:text-primary-foreground">Why LoadLead</a>
          </nav>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" className="text-primary-foreground hover:bg-white/10 hover:text-primary-foreground">
              <Link to="/login">Sign in</Link>
            </Button>
            <Button asChild className="bg-accent text-accent-foreground hover:bg-accent/90">
              <Link to="/signup">Open dashboard <ArrowRight className="h-4 w-4" /></Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="cx-hero relative overflow-hidden text-sidebar-foreground">
        <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)", backgroundSize: "32px 32px" }} />
        <div className="relative max-w-7xl mx-auto px-6 pt-36 pb-28 grid lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-7 text-primary-foreground">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 border border-white/15 px-3 py-1 text-xs">
              <span className="h-2 w-2 rounded-full bg-accent animate-pulse" />
              Real-time dispatch. 15-minute TTL countdown.
            </div>
            <h1 className="mt-6 text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.05]">
              Freight that moves <span className="cx-hi">the second</span> you post it.
            </h1>
            <p className="mt-6 text-lg text-primary-foreground/75 max-w-xl">
              LoadLead broadcasts every load to drivers who actually qualify - by radius, capacity, equipment, and MC maturity. Match in seconds, not hours.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg" className="bg-accent text-accent-foreground hover:bg-accent/90 h-12 px-6">
                <Link to="/shipper/post">Post a load <ArrowRight className="h-4 w-4" /></Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-12 px-6 bg-transparent border-white/30 text-primary-foreground hover:bg-white/10 hover:text-primary-foreground">
                <Link to="/driver">I'm a driver</Link>
              </Button>
            </div>
            <div className="mt-10 flex flex-wrap gap-6 text-sm text-primary-foreground/70">
              <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 cx-hi" />Eligibility-aware</div>
              <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 cx-hi" />Real-time offers</div>
              <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 cx-hi" />5 roles, one platform</div>
            </div>
          </div>

          {/* Offer mockup */}
          <div className="lg:col-span-5 relative">
            <div className="absolute -inset-4 bg-accent/20 blur-3xl rounded-full" />
            <div className="relative cx-frost text-card-foreground rounded-lg shadow-2xl overflow-hidden">
              <div className="bg-secondary/60 px-5 py-3 flex items-center justify-between border-b border-border">
                <div className="flex items-center gap-2 text-xs font-semibold text-primary">
                  <Radio className="h-3.5 w-3.5" /> NEW LOAD OFFER
                </div>
                <div className="flex items-center gap-1 text-xs font-mono text-warning"><Clock className="h-3.5 w-3.5" /> 12:47</div>
              </div>
              <div className="p-6 space-y-5">
                <div>
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-muted-foreground">Demo Freight Co · L-10421</div>
                    <div className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">Dry Van</div>
                  </div>
                  <div className="mt-3 flex items-start gap-3">
                    <div className="flex flex-col items-center pt-1">
                      <div className="h-2.5 w-2.5 rounded-full bg-primary" />
                      <div className="w-px flex-1 bg-border my-1 min-h-[28px]" />
                      <div className="h-2.5 w-2.5 rounded-full bg-accent" />
                    </div>
                    <div className="flex-1 space-y-3">
                      <div>
                        <div className="text-sm font-semibold">Chicago, IL</div>
                        <div className="text-xs text-muted-foreground">Pickup · Today 4:30 PM</div>
                      </div>
                      <div>
                        <div className="text-sm font-semibold">Columbus, OH</div>
                        <div className="text-xs text-muted-foreground">Drop · Tomorrow 6:00 AM</div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3 pt-4 border-t border-border">
                  <Stat label="Miles" value="355" />
                  <Stat label="Weight" value="28.4k" />
                  <Stat label="Rate" value="$1,012" accent />
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <Button variant="outline" className="h-11">Decline</Button>
                  <Button className="h-11 bg-success text-success-foreground hover:bg-success/90">Accept load</Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Metrics strip */}
      <section id="metrics" className="bg-background">
        <div className="max-w-7xl mx-auto px-6 py-10">
         <div className="cx-frost rounded-2xl px-6 py-8 grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {[
            { v: "47s", l: "avg. time to match" },
            { v: "94%", l: "offer accept rate" },
            { v: "15m", l: "offer TTL countdown" },
            { v: "4", l: "roles, one workspace" },
          ].map((m) => (
            <div key={m.l}>
              <div className="text-4xl font-bold text-primary tracking-tight">{m.v}</div>
              <div className="text-xs uppercase tracking-widest text-muted-foreground mt-2">{m.l}</div>
            </div>
          ))}
         </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="max-w-7xl mx-auto px-6 py-24">
        <div className="max-w-2xl">
          <div className="text-xs uppercase tracking-widest text-primary font-semibold">How it works</div>
          <h2 className="mt-3 text-4xl font-bold tracking-tight">Post once. Broadcast to the right trucks only.</h2>
          <p className="mt-4 text-muted-foreground">Eligibility is enforced server-side - radius, capacity math, MC maturity, insurance, endorsements. Drivers see offers they can actually run.</p>
        </div>
        <div className="mt-12 grid md:grid-cols-3 gap-6">
          {[
            { icon: PackageCheck, title: "Shipper posts", body: "Origin, destination, weight, equipment. Submit triggers a broadcast." },
            { icon: Radio, title: "Eligible drivers ping", body: "Only trucks within radius, with capacity and the right equipment, get the offer." },
            { icon: Gauge, title: "First accept wins", body: "Load books to the first qualified driver to tap accept inside the 15-min window." },
          ].map((s, i) => (
            <div key={s.title} className="relative rounded-lg cx-frost p-7">
              <div className="text-xs font-mono text-muted-foreground">0{i + 1}</div>
              <div className="mt-4 h-11 w-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                <s.icon className="h-5 w-5" />
              </div>
              <h3 className="mt-5 text-lg font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Roles */}
      <section id="roles" className="bg-secondary/40 border-y border-border">
        <div className="max-w-7xl mx-auto px-6 py-24">
          <div className="text-center max-w-2xl mx-auto">
            <div className="text-xs uppercase tracking-widest text-primary font-semibold">For your team</div>
            <h2 className="mt-3 text-4xl font-bold tracking-tight">One platform. Five purpose-built dashboards.</h2>
          </div>
          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              // Exact five personas per LoadLead_Reference_Refactored.md.
              // Admin is NOT a public persona; provisioning is out of band only.
              { icon: Building2,   role: "Carrier",        desc: "Run a trucking company. Onboard drivers and dispatch loads.",                  to: "/signup?role=CARRIER",        cta: "Sign up" },
              { icon: Briefcase,   role: "Owner Operator", desc: "Drive yourself and manage your own fleet.",                                    to: "/signup?role=OWNER_OPERATOR", cta: "Sign up" },
              { icon: ShipWheel,   role: "Driver",         desc: "Accept loads matched to you. Join a carrier or owner operator to start hauling.", to: "/signup?role=DRIVER",      cta: "Sign up" },
              { icon: PackageCheck,role: "Shipper",        desc: "Post loads and reach verified carriers instantly.",                            to: "/signup?role=SHIPPER",        cta: "Sign up" },
              { icon: MapPin,      role: "Receiver",       desc: "Track inbound deliveries to your facility in real time.",                      to: "/signup?role=RECEIVER",       cta: "Sign up" },
            ].map((r) => {
              const Card = (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div className="h-11 w-11 rounded-sm bg-secondary text-primary flex items-center justify-center">
                      <r.icon className="h-5 w-5" strokeWidth={1.75} />
                    </div>
                  </div>
                  <h3 className="mt-5 text-lg font-semibold">{r.role}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{r.desc}</p>
                  <div className="mt-5 text-sm font-medium text-primary inline-flex items-center gap-1 group-hover:gap-2 transition-all">
                    {r.cta} <ArrowRight className="h-4 w-4" />
                  </div>
                </>
              );
              const className = "group rounded-lg cx-frost p-6 hover:shadow-elev-2 hover:-translate-y-0.5 transition-all cursor-pointer block";
              return <Link key={r.role} to={r.to} className={className}>{Card}</Link>;
            })}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-7xl mx-auto px-6 py-24">
        <div className="cx-footcta rounded-lg p-12 md:p-16 text-sidebar-foreground relative overflow-hidden">
          <div className="absolute inset-0 opacity-[0.08]" style={{ backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)", backgroundSize: "28px 28px" }} />
          <div className="relative max-w-2xl">
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight">Ready to dispatch like it's 2026?</h2>
            <p className="mt-4 text-primary-foreground/80">Skip the load-board scroll. LoadLead routes freight to the right truck the moment it's posted.</p>
            <div className="mt-8 flex gap-3">
              <Button asChild size="lg" className="bg-accent text-accent-foreground hover:bg-accent/90 h-12 px-6">
                <Link to="/login">Get started <ArrowRight className="h-4 w-4" /></Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="max-w-7xl mx-auto px-6 py-8 flex flex-wrap items-center justify-between gap-4 text-sm text-muted-foreground">
          <Logo />
          <div>© {new Date().getFullYear()} LoadLead. Built for the road.</div>
        </div>
      </footer>
    </div>
  );
}

// Small stat block used inside the hero load-card mockup.
function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`text-base font-semibold ${accent ? "text-primary" : ""}`}>{value}</div>
    </div>
  );
}
