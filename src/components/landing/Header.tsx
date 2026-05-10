import { Link } from "@tanstack/react-router";

export function Header() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4 backdrop-blur-md border-b border-white/5">
      <div className="flex items-center gap-2">
        <div className="flex items-center justify-center w-8 h-8 rounded-sm bg-[#ccff00] text-black font-bold text-lg">
          V
        </div>
        <span className="text-xl font-serif italic tracking-wide text-white">Velure</span>
      </div>

      <nav className="hidden md:flex items-center gap-8 text-sm text-slate-400">
        <a href="#features" className="hover:text-white transition-colors">
          Features
        </a>
        <a href="#interface" className="hover:text-white transition-colors">
          Interface
        </a>
        <a href="#pricing" className="hover:text-white transition-colors">
          Pricing
        </a>
      </nav>

      <div className="flex items-center gap-4">
        <Link to="/invoices" className="text-sm text-slate-300 hover:text-white transition-colors">
          Log In
        </Link>
        <Link
          to="/invoices"
          className="px-4 py-2 text-sm font-medium text-black bg-white rounded-md hover:bg-slate-200 transition-colors"
        >
          START FREE
        </Link>
      </div>
    </header>
  );
}
