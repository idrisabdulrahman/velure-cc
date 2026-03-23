import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { formatMoney } from "#/features/invoices/format";

export const Route = createFileRoute("/invoices/products")({
  component: InvoiceProductsPage,
});

function InvoiceProductsPage() {
  const products = useQuery(api.invoices.products, {}) ?? [];

  return (
    <section className="ui-panel overflow-hidden rounded-md border border-[#2b2d30] bg-[#17191b]">
      <div className="border-b border-[#2b2d30] px-4 py-3">
        <h1 className="text-lg font-medium text-[#ece7de]">Invoice products</h1>
        <p className="mt-1 text-sm text-[#a29b90]">Aggregated from invoice data.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-[#15171a]">
            <tr className="border-b border-[#2b2d30] text-left text-[#8a857d]">
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Usage</th>
              <th className="px-4 py-3 font-medium">Quantity</th>
              <th className="px-4 py-3 text-right font-medium">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr
                key={product.name}
                className="border-b border-[#2b2d30] text-[#d5d0c7] hover:bg-[#1c1f22]"
              >
                <td className="px-4 py-3 font-medium text-[#ece7de]">{product.name}</td>
                <td className="px-4 py-3 text-[#b7b1a7]">{product.usedIn}</td>
                <td className="px-4 py-3 text-[#b7b1a7]">{product.quantity}</td>
                <td className="px-4 py-3 text-right font-medium text-[#ece7de]">
                  {formatMoney(product.amount, product.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
