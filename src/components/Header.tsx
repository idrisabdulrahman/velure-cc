import { Link } from '@tanstack/react-router'
import { FileText, Home, Menu, Package, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from './ui/button'

export default function Header() {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      <header className="z-50 px-6 border-b border-border h-[70px] flex items-center backdrop-blur-xl">
        <Button
          onClick={() => setIsOpen(true)}
          className="p-2 hover:bg-secondary rounded-lg transition-colors"
          aria-label="Open menu"
        >
          <Menu size={20} />
        </Button>
        <h1 className="ml-4 text-lg font-serif">
          <Link to="/invoices" className="transition-colors">
            Invoice Gen
          </Link>
        </h1>
      </header>

      <aside
        className={`fixed top-0 left-0 h-full w-80 bg-background border-r border-border shadow-2xl z-50 transform transition-transform duration-300 ease-in-out flex flex-col ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-serif">Navigation</h2>
          <Button
            onClick={() => setIsOpen(false)}
            className="p-2 hover:bg-secondary rounded-lg transition-colors"
            aria-label="Close menu"
          >
            <X size={24} />
          </Button>
        </div>

        <nav className="flex-1 p-4 overflow-y-auto">
          <Link
            to="/"
            onClick={() => setIsOpen(false)}
            className="flex items-center gap-3 p-3 rounded-lg hover:bg-secondary transition-colors mb-2"
            activeProps={{
              className:
                'flex items-center gap-3 p-3 rounded-lg bg-secondary transition-colors mb-2',
            }}
          >
            <Home size={20} />
            <span className="font-medium">Home</span>
          </Link>

          <Link
            to="/invoices"
            onClick={() => setIsOpen(false)}
            className="flex items-center gap-3 p-3 rounded-lg hover:bg-secondary transition-colors mb-2"
            activeProps={{
              className:
                'flex items-center gap-3 p-3 rounded-lg bg-secondary transition-colors mb-2',
            }}
          >
            <FileText size={20} />
            <span className="font-medium">Invoices</span>
          </Link>

          <Link
            to="/invoices/products"
            onClick={() => setIsOpen(false)}
            className="flex items-center gap-3 p-3 rounded-lg hover:bg-secondary transition-colors mb-2"
            activeProps={{
              className:
                'flex items-center gap-3 p-3 rounded-lg bg-secondary transition-colors mb-2',
            }}
          >
            <Package size={20} />
            <span className="font-medium">Products</span>
          </Link>
        </nav>
      </aside>
    </>
  )
}
