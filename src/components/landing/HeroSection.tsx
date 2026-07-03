import { ArrowRight } from "lucide-react";

export function HeroSection() {
	return (
		<section className="relative flex min-h-screen items-center overflow-hidden border-b border-[#23262a] bg-[#0f1114] pt-32 pb-20">
			<div className="container mx-auto px-6 grid lg:grid-cols-2 gap-12 items-center relative z-10">
				{/* Left Content */}
				<div className="max-w-xl">
					<div className="mb-8 inline-flex items-center gap-2 rounded-sm border border-[#30352f] bg-[#171a18] px-3 py-1 text-xs text-[#d8d1c4]">
						<span className="h-2 w-2 rounded-sm bg-[#c8ff62]" />
						NIGERIAN SME BILLING WORKSPACE
					</div>

					<h1 className="text-6xl md:text-7xl lg:text-8xl font-serif mb-6 leading-[1.1] tracking-tight">
						<span className="block italic text-white md:pr-12">Velure</span>
						<span className="block text-slate-300">gets you paid.</span>
					</h1>

					<p className="text-lg text-slate-400 mb-10 leading-relaxed max-w-md">
						Create compliant invoices, manage clients, collect Paystack
						payments, and keep lightweight product sales tidy without drifting
						into ERP complexity.
					</p>

					<div className="flex flex-wrap items-center gap-4">
						<a
							href="/invoices"
							className="px-6 py-3 font-medium text-black bg-[#ccff00] hover:bg-[#bbf000] transition-colors rounded-sm"
						>
							OPEN WORKSPACE
						</a>
						<a
							href="#features"
							className="flex items-center gap-2 px-2 py-3 font-medium text-slate-300 transition-colors hover:text-white"
						>
							SEE WHAT IT HANDLES
							<ArrowRight className="h-4 w-4" />
						</a>
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
							className="absolute inset-0 bg-[#0f1111] border border-[#30352f] rounded-sm p-8 shadow-2xl z-20 flex flex-col justify-between"
							style={{ boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.7)" }}
						>
							<div>
								<div className="flex justify-between items-start mb-12">
									<div className="w-8 h-8 rounded-full bg-[#30352f]" />
									<div className="text-right">
										<div className="text-[10px] text-[#817d72] uppercase tracking-[0.2em] mb-1 font-mono">
											TOTAL DUE
										</div>
										<div className="text-3xl font-serif italic text-[#f2efe7]">
											₦12,450,000
										</div>
									</div>
								</div>

								<div className="space-y-4 text-xs font-mono text-[#817d72] border-b border-[#30352f] pb-8 mb-8">
									<div className="flex justify-between">
										<span>Billed to</span>
										<span className="text-[#f2efe7]">Apex Foods Ltd</span>
									</div>
									<div className="flex justify-between">
										<span>Due Date</span>
										<span className="text-[#f2efe7]">24 Jun 2026</span>
									</div>
								</div>
							</div>

							<div className="w-full py-3 text-center text-xs font-medium tracking-[0.1em] text-[#c8ff62] bg-[#c8ff62]/10 border border-[#c8ff62]/20 rounded-sm font-mono mt-auto">
								STATUS: PAID
							</div>
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}
