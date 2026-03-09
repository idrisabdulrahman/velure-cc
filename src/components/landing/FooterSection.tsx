export function FooterSection() {
	return (
		<footer className="w-full mt-12 bg-black border-t border-slate-900 pt-24 pb-12">
			<div className="max-w-5xl mx-auto px-6">
				{/* Pre-footer CTA */}
				<div className="text-center mb-32">
					<h2 className="text-5xl md:text-6xl font-serif italic text-white mb-6">
						Ready to elevate?
					</h2>
					<p className="text-slate-400 mb-8">
						Join 10,000+ designers, developers, and consultants who trust
						Velure.
					</p>
					<div className="flex max-w-md mx-auto">
						<input
							type="email"
							placeholder="email@address.com"
							className="px-4 py-3 bg-[#111] border-y border-l border-slate-800 text-white rounded-l-sm focus:outline-none focus:border-slate-600 flex-1 placeholder:text-slate-600 text-sm"
						/>
						<button type="button" className="px-6 py-3 bg-white text-black font-semibold text-sm rounded-r-sm hover:bg-slate-200 transition-colors whitespace-nowrap">
							GET ACCESS
						</button>
					</div>
				</div>

				{/* Main Footer Content */}
				<div className="grid grid-cols-2 md:grid-cols-4 gap-12 mb-16 border-b border-slate-900 pb-16">
					<div className="col-span-2 md:col-span-1">
						<div className="flex items-center gap-2 mb-6">
							<div className="flex items-center justify-center w-6 h-6 rounded-sm bg-[#ccff00] text-black font-bold text-sm">
								V
							</div>
							<span className="text-lg font-serif italic tracking-wide text-white">
								Velure
							</span>
						</div>
						<p className="text-xs text-slate-500 leading-relaxed pr-4">
							The standard for luxury invoicing. Crafted for the
							detail-obsessed.
						</p>
					</div>

					<div>
						<h4 className="text-xs font-bold text-slate-300 uppercase tracking-widest mb-6">
							Product
						</h4>
						<ul className="space-y-4 text-xs tracking-wide text-slate-500">
							<li>
								<a href="/" className="hover:text-white transition-colors">
									Invoicing
								</a>
							</li>
							<li>
								<a href="/" className="hover:text-white transition-colors">
									Clients
								</a>
							</li>
							<li>
								<a href="/" className="hover:text-white transition-colors">
									Pricing
								</a>
							</li>
						</ul>
					</div>

					<div>
						<h4 className="text-xs font-bold text-slate-300 uppercase tracking-widest mb-6">
							Company
						</h4>
						<ul className="space-y-4 text-xs tracking-wide text-slate-500">
							<li>
								<a href="/" className="hover:text-white transition-colors">
									About
								</a>
							</li>
							<li>
								<a href="/" className="hover:text-white transition-colors">
									Manifesto
								</a>
							</li>
							<li>
								<a href="/" className="hover:text-white transition-colors">
									Contact
								</a>
							</li>
						</ul>
					</div>

					<div>
						<h4 className="text-xs font-bold text-slate-300 uppercase tracking-widest mb-6">
							Legal
						</h4>
						<ul className="space-y-4 text-xs tracking-wide text-slate-500">
							<li>
								<a href="/" className="hover:text-white transition-colors">
									Terms
								</a>
							</li>
							<li>
								<a href="/" className="hover:text-white transition-colors">
									Privacy
								</a>
							</li>
						</ul>
					</div>
				</div>

				<div className="flex items-center justify-between text-[10px] text-slate-600 uppercase tracking-widest font-mono">
					<p>© 2026 Velure Inc.</p>
					<p>Designed by Void Build</p>
				</div>
			</div>
		</footer>
	);
}
