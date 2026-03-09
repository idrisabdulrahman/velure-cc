import { createFileRoute } from '@tanstack/react-router'
import { Download, ExternalLink } from 'lucide-react'
import { useQuery } from 'convex/react'
import {
  getInvoiceTemplateSize,
  toMiddayInvoice,
} from '#/features/invoices/midday-adapter'
import { Button } from '#/components/ui/button'
import { HtmlTemplate } from '#/lib/midday-invoice/templates/html'
import { api } from '../../convex/_generated/api'

export const Route = createFileRoute('/i/$token')({
  component: PublicInvoicePage,
})

function PublicInvoicePage() {
  const { token } = Route.useParams()
  const invoice = useQuery(api.invoices.getByToken, { token })

  if (invoice === undefined) {
    return (
      <section className="mx-auto w-full max-w-[980px] p-4 md:p-8">
        <div className="animate-pulse border border-[#1A1D22] bg-[#0A0E15] p-4">
          <div className="mb-3 h-4 w-52 bg-[#1A1D22]" />
          <div className="h-[700px] w-full bg-[#0F141E]" />
        </div>
      </section>
    )
  }

  if (!invoice) {
    return (
      <section className="mx-auto w-full max-w-[740px] p-4 md:p-8">
        <div className="border border-[#351A1A] bg-[#130B0E] p-5">
          <h2 className="text-lg font-medium text-[#F1D9DE]">Invoice not found</h2>
          <p className="mt-1 text-xs text-[#B58A95]">Token: {token}</p>
        </div>
      </section>
    )
  }

  const middayInvoice = toMiddayInvoice(invoice)
  const { width, height } = getInvoiceTemplateSize(middayInvoice.template)
  const previewScale = invoice.invoiceSize === 'LETTER' ? 1.18 : 1.32
  const previewWidth = Math.round(width * previewScale)
  const previewHeight = Math.round(height * previewScale)
  const encodedId = encodeURIComponent(invoice.id)
  const downloadUrl = `/api/invoice/download/${encodedId}`
  const previewUrl = `${downloadUrl}?preview=true`
  const paperLabel = invoice.invoiceSize === 'LETTER' ? 'Letter' : 'A4'

  return (
    <section className="w-full">
      <div className="mx-auto flex w-full max-w-[1020px] flex-col gap-4 px-2 py-4 sm:px-4 sm:py-8">
        <div className="border border-[#1A1D22] bg-[#0A0E15] px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-medium text-[#E9EEF5]">Invoice {invoice.invoiceNumber}</h2>
              <p className="text-xs text-[#8A94A2]">
                Public preview • {paperLabel} • {invoice.currency}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild variant="ghost" className="h-8 rounded-none border border-[#1A1D22] bg-[#0D1118] px-3 text-xs">
                <a href={previewUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                  Preview PDF
                </a>
              </Button>
              <Button asChild className="h-8 rounded-none border border-[#2A351A] bg-[#C8FF1A]/30 px-3 text-xs font-semibold text-[#DFFF62] hover:bg-[#C8FF1A]/45">
                <a href={downloadUrl}>
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  Download PDF
                </a>
              </Button>
            </div>
          </div>
        </div>

        <div className="flex justify-center overflow-auto border border-[#1A1D22] bg-[#0A0E15] p-3 shadow-[0_24px_48px_-12px_rgba(0,0,0,0.55)]">
          <div className="w-full max-w-full">
            <HtmlTemplate data={middayInvoice} width={previewWidth} height={previewHeight} />
          </div>
        </div>
      </div>
    </section>
  )
}
