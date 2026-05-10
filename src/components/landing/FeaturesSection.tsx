import { Check, Download, Users } from "lucide-react";
import { useId } from "react";

export function FeaturesSection() {
  const id = useId();
  return (
    <section id={id} className="py-24 max-w-5xl mx-auto px-6">
      <div className="grid md:grid-cols-2 gap-6">
        {/* Feature 1: Export PDF */}
        <div className="bg-[#111] border border-[#222] rounded-xl p-10 flex flex-col hover:border-slate-700 transition-colors group">
          <div className="w-12 h-12 rounded-lg bg-[#ccff00]/10 flex items-center justify-center mb-8 border border-[#ccff00]/20">
            <Download className="w-6 h-6 text-[#ccff00]" />
          </div>

          <h3 className="text-2xl font-serif text-white mb-3">Export to PDF instantly</h3>
          <p className="text-slate-400 mb-12">
            Generates pristine, print-ready PDFs with a single click. No more formatting nightmares
            in Word.
          </p>

          <div className="mt-auto">
            {/* Visual element for feature 1 */}
            <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg p-4 flex items-center gap-4 w-max shadow-lg transform group-hover:translate-y-[-4px] transition-transform">
              <div className="w-10 h-10 rounded bg-[#2a2a2a] flex items-center justify-center text-[10px] font-bold text-slate-500">
                PDF
              </div>
              <div>
                <div className="text-sm text-slate-200">invoice_1024.pdf</div>
                <div className="text-xs text-slate-500">2.4 MB</div>
              </div>
              <div className="ml-4 w-6 h-6 rounded-full border border-slate-700 flex items-center justify-center bg-slate-800">
                <Check className="w-3 h-3 text-[#ccff00]" />
              </div>
            </div>
          </div>
        </div>

        {/* Feature 2: CRM Lite */}
        <div className="bg-[#111] border border-[#222] rounded-xl p-10 flex flex-col hover:border-slate-700 transition-colors">
          <div className="w-12 h-12 rounded-lg bg-slate-800 flex items-center justify-center mb-8 border border-slate-700">
            <Users className="w-6 h-6 text-white" />
          </div>

          <h3 className="text-2xl font-serif text-white mb-3">CRM Lite</h3>
          <p className="text-slate-400 mb-12">
            Keep detailed records of every client interaction and payment history.
          </p>

          <div className="mt-auto space-y-4">
            {/* Feature list items */}
            <div className="flex items-center gap-3 text-sm font-mono text-slate-300">
              <span className="w-1.5 h-1.5 rounded-full bg-[#ccff00]" /> Auto-save contacts
            </div>
            <div className="flex items-center gap-3 text-sm font-mono text-slate-300">
              <span className="w-1.5 h-1.5 rounded-full bg-[#ccff00]" /> LTV Tracking
            </div>
            <div className="flex items-center gap-3 text-sm font-mono text-slate-300">
              <span className="w-1.5 h-1.5 rounded-full bg-[#ccff00]" /> Notes & attachments
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
