import {
	Bell,
	FileText,
	LayoutGrid,
	Search,
	Settings,
	Users,
} from "lucide-react";
import { useId } from "react";
import { Button } from "../ui/button";

export function CommandCenterSection() {
	const id = useId();
	return (
		<section id={id} className="py-24 max-w-5xl mx-auto px-6">
			<div className="mb-12">
				<h2 className="text-4xl md:text-5xl font-serif italic text-white mb-4">
					Command Center
				</h2>
				<div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
					<p className="text-slate-400 max-w-sm">
						Your financial headquarters. Toggle tabs to preview the experience.
					</p>
					<div className="flex bg-slate-900 border border-slate-800 rounded-md p-1">
						<Button className="px-6 py-2 text-sm font-medium bg-white text-black rounded-sm shadow-sm">
							Invoices
						</Button>
						<Button className="px-6 py-2 text-sm font-medium text-slate-400 hover:text-white transition-colors">
							Clients
						</Button>
					</div>
				</div>
			</div>

			{/* Mockup Dashboard Shell */}
			<div className="rounded-xl border border-slate-800 bg-slate-950 overflow-hidden shadow-2xl flex flex-col min-h-[500px]">
				{/* Mockup Window Controls & Header bar */}
				<div className="flex items-center justify-between px-4 py-3 border-b border-slate-800/60 bg-slate-900/40">
					<div className="flex gap-2">
						<div className="w-3 h-3 rounded-full bg-red-500/80" />
						<div className="w-3 h-3 rounded-full bg-amber-500/80" />
						<div className="w-3 h-3 rounded-full bg-green-500/80" />
					</div>
					<div className="flex items-center gap-4 text-slate-400">
						<Search className="w-4 h-4 cursor-pointer hover:text-white" />
						<Bell className="w-4 h-4 cursor-pointer hover:text-white" />
						<div className="w-6 h-6 rounded-full bg-gradient-to-tr from-[#ccff00] to-teal-400" />
					</div>
				</div>

				<div className="flex flex-1 overflow-hidden">
					{/* Mockup Sidebar */}
					<div className="w-16 border-r border-slate-800/60 bg-slate-900/20 flex flex-col items-center py-6 gap-8">
						<Button className="p-2 bg-slate-800/80 rounded-md text-[#ccff00]">
							<LayoutGrid className="w-5 h-5" />
						</Button>
						<Button className="p-2 text-slate-500 hover:text-white transition-colors">
							<Users className="w-5 h-5" />
						</Button>
						<Button className="p-2 text-slate-500 hover:text-white transition-colors">
							<FileText className="w-5 h-5" />
						</Button>
						<Button className="p-2 text-slate-500 hover:text-white transition-colors mt-auto">
							<Settings className="w-5 h-5" />
						</Button>
					</div>

					{/* Mockup Content Area: Invoices List */}
					<div className="flex-1 p-8 bg-[#0a0a0a]">
						<div className="flex items-center justify-between mb-8">
							<h3 className="text-xl text-white font-serif">Recent Invoices</h3>
							<Button className="px-4 py-2 bg-[#ccff00] text-black text-xs font-semibold tracking-wider rounded-sm hover:bg-[#bbf000] flex items-center gap-1">
								+ NEW INVOICE
							</Button>
						</div>

						<div className="w-full text-left">
							<div className="grid grid-cols-4 text-xs font-mono text-slate-500 border-b border-slate-800/60 pb-4 mb-4 uppercase tracking-widest">
								<div className="col-span-2">CLIENT / PROJECT</div>
								<div>DATE</div>
								<div>AMOUNT</div>
								<div className="text-right">STATUS</div>
							</div>

							<div className="space-y-2">
								{/* Invoice Row 1 */}
								<div className="grid grid-cols-4 items-center py-4 border-b border-slate-800/40 hover:bg-slate-900/40 transition-colors px-2 -mx-2 rounded-md">
									<div className="col-span-2 flex items-center gap-3">
										<div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-xs font-serif text-white">
											M
										</div>
										<div>
											<div className="text-sm text-slate-200">
												Monolith Corp
											</div>
											<div className="text-xs text-slate-500">Q4 Branding</div>
										</div>
									</div>
									<div className="text-sm text-slate-400 font-mono">Oct 12</div>
									<div className="text-sm text-slate-200 font-mono">
										$14,200.00
									</div>
									<div className="text-right">
										<span className="inline-flex items-center px-2 py-1 bg-[#ccff00]/10 text-[#ccff00] text-[10px] font-bold tracking-wider rounded border border-[#ccff00]/20">
											PAID
										</span>
									</div>
								</div>

								{/* Invoice Row 2 */}
								<div className="grid grid-cols-4 items-center py-4 border-b border-slate-800/40 hover:bg-slate-900/40 transition-colors px-2 -mx-2 rounded-md">
									<div className="col-span-2 flex items-center gap-3">
										<div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-xs font-serif text-purple-400">
											S
										</div>
										<div>
											<div className="text-sm text-slate-200">Studio Kura</div>
											<div className="text-xs text-slate-500">
												Web Development
											</div>
										</div>
									</div>
									<div className="text-sm text-slate-400 font-mono">Oct 15</div>
									<div className="text-sm text-slate-200 font-mono">
										$8,450.00
									</div>
									<div className="text-right">
										<span className="inline-flex items-center px-2 py-1 bg-amber-500/10 text-amber-500 text-[10px] font-bold tracking-wider rounded border border-amber-500/20">
											PENDING
										</span>
									</div>
								</div>

								{/* Invoice Row 3 */}
								<div className="grid grid-cols-4 items-center py-4 hover:bg-slate-900/40 transition-colors px-2 -mx-2 rounded-md">
									<div className="col-span-2 flex items-center gap-3">
										<div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-xs font-serif text-blue-400">
											A
										</div>
										<div>
											<div className="text-sm text-slate-200">Apex Systems</div>
											<div className="text-xs text-slate-500">Retainer</div>
										</div>
									</div>
									<div className="text-sm text-slate-400 font-mono">Oct 18</div>
									<div className="text-sm text-slate-200 font-mono">
										$5,000.00
									</div>
									<div className="text-right">
										<span className="inline-flex items-center px-2 py-1 bg-slate-800 text-slate-400 text-[10px] font-bold tracking-wider rounded border border-slate-700">
											DRAFT
										</span>
									</div>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}
