'use client';

import Image from 'next/image';
import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="max-w-6xl mx-auto px-6 py-12 lg:py-16 flex flex-col lg:flex-row items-center gap-10">
        {/* Left copy */}
        <div className="flex-1 space-y-6">
          <div className="space-y-2">
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-white">LoadLead</h1>
            <p className="text-lg text-slate-200">Your freight, streamlined.</p>
          </div>

          <div className="space-y-4 text-sm sm:text-base leading-relaxed text-slate-200">
            <p className="font-semibold text-slate-100">Get ready to roll in minutes.</p>
            <ol className="space-y-2 list-decimal list-inside text-slate-200">
              <li><span className="font-semibold text-white">Basic Info:</span> name, email, mobile for verification.</li>
              <li><span className="font-semibold text-white">Business Details:</span> MC/DOT and insurance.</li>
              <li><span className="font-semibold text-white">Equipment & Capacity:</span> truck/trailer, endorsements, current load.</li>
              <li><span className="font-semibold text-white">Payments:</span> rate terms and billing preferences.</li>
            </ol>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/signup"
              className="px-5 py-3 rounded-full bg-slate-100 text-slate-900 font-semibold hover:bg-white transition"
            >
              Sign up now
            </Link>
            <Link
              href="/login"
              className="px-5 py-3 rounded-full border border-slate-500 text-slate-100 font-semibold hover:border-white transition"
            >
              Log in
            </Link>
          </div>
        </div>

        {/* Right image */}
        <div className="flex-1 w-full">
          <div className="relative w-full aspect-[4/5] rounded-2xl overflow-hidden border border-slate-800 shadow-2xl">
            <Image
              src="/hero-truck.jpg"
              alt="Owner-operator with truck"
              fill
              priority
              className="object-cover"
            />
          </div>
          <p className="mt-3 text-xs text-slate-400 text-right">Tip: Place hero-truck.jpg in frontend/public/</p>
        </div>
      </div>
    </main>
  );
}
