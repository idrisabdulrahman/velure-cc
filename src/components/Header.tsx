import { Link } from "@tanstack/react-router";
import { FileText, Home, Menu, Package, X } from "lucide-react";
import { useState } from "react";
import { Button } from "./ui/button";

export default function Header() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <header className="z-50 px-6 border-b border-border h-[70px] flex items-center backdrop-blur-xl">
        <Button
          onClick={() => setIsOpen(true)}
          className="p-2 hover:bg-secondary rounded-md transition-colors"
          aria-label="Open menu"
        >
          <Menu size={20} />
        </Button>
        <h1 className="ml-4 text-lg font-serif">
          <Link to="/invoices" className="transition-colors">
            Velure
          </Link>
        </h1>
      </header>

      <aside
        className={`fixed top-0 left-0 h-full w-80 bg-background border-r border-border shadow-2xl z-50 transform transition-transform duration-300 ease-in-out flex flex-col ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-serif">Navigation</h2>
          <Button
            onClick={() => setIsOpen(false)}
            className="p-2 hover:bg-secondary rounded-md transition-colors"
            aria-label="Close menu"
          >
            <X size={24} />
          </Button>
        </div>

        <nav className="flex-1 p-4 overflow-y-auto">
          <Link
            to="/"
            onClick={() => setIsOpen(false)}
            className="mb-2 flex items-center gap-3 rounded-md p-3 transition-colors hover:bg-secondary"
            activeProps={{
              className:
                "mb-2 flex items-center gap-3 rounded-md bg-secondary p-3 transition-colors",
            }}
          >
            <Home size={20} />
            <span className="font-medium">Home</span>
          </Link>

          <Link
            to="/invoices"
            onClick={() => setIsOpen(false)}
            className="mb-2 flex items-center gap-3 rounded-md p-3 transition-colors hover:bg-secondary"
            activeProps={{
              className:
                "mb-2 flex items-center gap-3 rounded-md bg-secondary p-3 transition-colors",
            }}
          >
            <FileText size={20} />
            <span className="font-medium">Invoices</span>
          </Link>

          <Link
            to="/invoices/products"
            onClick={() => setIsOpen(false)}
            className="mb-2 flex items-center gap-3 rounded-md p-3 transition-colors hover:bg-secondary"
            activeProps={{
              className:
                "mb-2 flex items-center gap-3 rounded-md bg-secondary p-3 transition-colors",
            }}
          >
            <Package size={20} />
            <span className="font-medium">Products</span>
          </Link>
        </nav>
      </aside>
    </>
  );
}
