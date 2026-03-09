import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { formatMoney } from '#/features/invoices/format'

export const Route = createFileRoute('/invoices/products')({
  component: InvoiceProductsPage,
})

function InvoiceProductsPage() {
  const products = useQuery(api.invoices.products, {}) ?? []

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <h2 className="text-lg font-medium">Invoice Products</h2>
      <p className="mb-4 text-sm text-slate-400">Aggregated from invoice API data.</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-slate-400">
              <th className="py-2">Name</th>
              <th className="py-2">Usage</th>
              <th className="py-2">Quantity</th>
              <th className="py-2 text-right">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.name} className="border-b border-slate-900">
                <td className="py-2">{product.name}</td>
                <td className="py-2 text-slate-300">{product.usedIn}</td>
                <td className="py-2 text-slate-300">{product.quantity}</td>
                <td className="py-2 text-right">
                  {formatMoney(product.amount, product.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
