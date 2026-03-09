import { Check } from "lucide-react";
import { useId } from "react";

export function PricingSection() {
	const id = useId();
	return (
		<section id={id} className="py-24 max-w-4xl mx-auto px-6">
			<div className="text-center mb-16">
				<h2 className="text-4xl md:text-5xl font-serif italic text-white mb-4">
					Simple Pricing
				</h2>
				<p className="text-slate-400">
					Pay for the tool, not the transaction fees.
				</p>
			</div>

			<div className="grid md:grid-cols-2 gap-6">
				{/* Freelancer Tier */}
				<div className="bg-[#0a0a0a] border border-[#222] rounded-xl p-8 flex flex-col relative">
					<h3 className="text-xl text-white mb-2">Freelancer</h3>
					<div className="flex items-baseline gap-1 mb-8">
						<span className="text-4xl font-serif text-white">$0</span>
						<span className="text-slate-500 text-sm">/forever</span>
					</div>

					<div className="space-y-4 mb-12 flex-1">
						<div className="flex items-center gap-3 text-slate-400 text-sm">
							<Check className="w-4 h-4 text-slate-600" /> 3 Clients Max
						</div>
						<div className="flex items-center gap-3 text-slate-400 text-sm">
							<Check className="w-4 h-4 text-slate-600" /> Standard PDF
							Templates
						</div>
						<div className="flex items-center gap-3 text-slate-400 text-sm">
							<Check className="w-4 h-4 text-slate-600" /> Basic Dashboard
						</div>
					</div>

					<button type="button" className="w-full py-3 text-sm font-medium tracking-wide text-white bg-transparent border border-slate-700 rounded-sm hover:bg-slate-800 transition-colors uppercase">
						Start Free
					</button>
				</div>

				{/* Studio Tier (Highlighted) */}
				<div className="bg-slate-900 border border-[#ccff00] rounded-xl p-8 flex flex-col relative scale-[1.02] shadow-[0_0_30px_rgba(204,255,0,0.1)]">
					{/* Badge */}
					<div className="absolute top-0 right-6 translate-y-[-50%] bg-[#ccff00] text-black text-[10px] font-bold tracking-widest uppercase px-3 py-1 rounded-sm">
						Most Popular
					</div>

					<h3 className="text-xl text-[#ccff00] mb-2">Studio</h3>
					<div className="flex items-baseline gap-1 mb-8">
						<span className="text-4xl font-serif text-white">$29</span>
						<span className="text-slate-500 text-sm">/month</span>
					</div>

					<div className="space-y-4 mb-12 flex-1">
						<div className="flex items-center gap-3 text-slate-200 text-sm">
							<Check className="w-4 h-4 text-[#ccff00]" /> Unlimited Clients
						</div>
						<div className="flex items-center gap-3 text-slate-200 text-sm">
							<Check className="w-4 h-4 text-[#ccff00]" /> Custom Branding
						</div>
						<div className="flex items-center gap-3 text-slate-200 text-sm">
							<Check className="w-4 h-4 text-[#ccff00]" /> Multi-currency
							Support
						</div>
						<div className="flex items-center gap-3 text-slate-200 text-sm">
							<Check className="w-4 h-4 text-[#ccff00]" /> Priority Support
						</div>
					</div>

					<button type="button" className="w-full py-3 text-sm font-medium tracking-wide text-black bg-[#ccff00] hover:bg-[#bbf000] rounded-sm transition-colors uppercase">
						Get Started
					</button>
				</div>
			</div>
		</section>
	);
}
