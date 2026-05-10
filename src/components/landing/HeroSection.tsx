import { Play } from "lucide-react";

export function HeroSection() {
  return (
    <section className="relative pt-32 pb-20 overflow-hidden min-h-screen flex items-center">
      {/* Background gradients / effects */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-[#ccff00]/5 rounded-full blur-[120px] pointer-events-none" />

      <div className="container mx-auto px-6 grid lg:grid-cols-2 gap-12 items-center relative z-10">
        {/* Left Content */}
        <div className="max-w-xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 mb-8 rounded-full border border-white/10 bg-white/5 backdrop-blur-sm text-xs text-slate-300">
            <span className="w-2 h-2 rounded-full bg-[#ccff00]" />V 2.0 NOW LIVE
          </div>

          <h1 className="text-6xl md:text-7xl lg:text-8xl font-serif mb-6 leading-[1.1] tracking-tight">
            <span className="block italic text-white md:pr-12">The art of</span>
            <span className="block text-slate-300">getting paid.</span>
          </h1>

          <p className="text-lg text-slate-400 mb-10 leading-relaxed max-w-md">
            Velure is the invoicing suite for creative professionals who refuse to compromise on
            aesthetics. Manage clients, track revenue, and look expensive while doing it.
          </p>

          <div className="flex flex-wrap items-center gap-4">
            <a
              href="/invoices/new"
              className="px-6 py-3 font-medium text-black bg-[#ccff00] hover:bg-[#bbf000] transition-colors rounded-sm"
            >
              CREATE INVOICE
            </a>
            <button
              type="button"
              className="px-6 py-3 font-medium text-slate-300 bg-transparent border border-slate-700 hover:bg-white/5 hover:text-white transition-colors rounded-sm flex items-center gap-2"
            >
              <Play className="w-4 h-4" />
              WATCH DEMO
            </button>
          </div>
        </div>

        {/* Right Content - Invoice Mockup */}
        <div className="relative mt-12 lg:mt-0 perspective-1000 w-full flex justify-center lg:justify-end">
          <div className="relative w-full max-w-[400px] aspect-[4/5]">
            {/* Background Layer 1 (bottom) */}
            <div className="absolute inset-0 bg-[#1A1A1A]/40 border border-[#2A2A2A] rounded-sm transform translate-x-12 translate-y-12 backdrop-blur-sm z-0" />

            {/* Background Layer 2 (middle) */}
            <div className="absolute inset-0 bg-[#1A1A1A]/60 border border-[#2A2A2A] rounded-sm transform translate-x-6 translate-y-6 backdrop-blur-md z-10" />

            {/* Top Layer - Main Card */}
            <div
              className="absolute inset-0 bg-[#0A0D12] border border-[#1A1D22] rounded-sm p-8 shadow-2xl z-20 flex flex-col justify-between"
              style={{ boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.7)" }}
            >
              <div>
                <div className="flex justify-between items-start mb-12">
                  <div className="w-8 h-8 rounded-full bg-[#1A1D22]" />
                  <div className="text-right">
                    <div className="text-[10px] text-[#8A8F99] uppercase tracking-[0.2em] mb-1 font-mono">
                      TOTAL DUE
                    </div>
                    <div className="text-3xl font-serif italic text-[#F2F3F5]">$12,450.00</div>
                  </div>
                </div>

                <div className="space-y-4 text-xs font-mono text-[#8A8F99] border-b border-[#1A1D22] pb-8 mb-8">
                  <div className="flex justify-between">
                    <span>Billed to</span>
                    <span className="text-[#F2F3F5]">Acme Corp</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Due Date</span>
                    <span className="text-[#F2F3F5]">Oct 24, 2024</span>
                  </div>
                </div>
              </div>

              <div className="w-full py-3 text-center text-xs font-medium tracking-[0.1em] text-[#C8FF1A] bg-[#C8FF1A]/10 border border-[#C8FF1A]/20 rounded-sm font-mono mt-auto">
                STATUS: PAID
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
