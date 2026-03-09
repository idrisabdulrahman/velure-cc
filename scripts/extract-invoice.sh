#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

rm -rf invoice-gen/extracted
mkdir -p invoice-gen/extracted

mkdir -p invoice-gen/extracted/packages
rsync -a packages/invoice invoice-gen/extracted/packages/

# Make extracted invoice package standalone (no monorepo tsconfig or workspace deps)
cat > invoice-gen/extracted/packages/invoice/tsconfig.json <<'EOF'
{
  "include": ["src"],
  "exclude": ["node_modules"],
  "compilerOptions": {
    "target": "ES2022",
    "jsx": "react-jsx",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"],
      "@api/*": ["../../apps/api/src/*"]
    }
  }
}
EOF

mkdir -p invoice-gen/extracted/apps/api/src/trpc/routers
mkdir -p invoice-gen/extracted/apps/api/src/schemas
cp apps/api/src/trpc/routers/invoice.ts invoice-gen/extracted/apps/api/src/trpc/routers/
cp apps/api/src/trpc/routers/invoice-products.ts invoice-gen/extracted/apps/api/src/trpc/routers/
cp apps/api/src/trpc/routers/invoice-template.ts invoice-gen/extracted/apps/api/src/trpc/routers/
cp apps/api/src/schemas/invoice.ts invoice-gen/extracted/apps/api/src/schemas/

mkdir -p invoice-gen/extracted/packages/db/src/queries
cp packages/db/src/queries/invoices.ts invoice-gen/extracted/packages/db/src/queries/
cp packages/db/src/queries/invoice-products.ts invoice-gen/extracted/packages/db/src/queries/
cp packages/db/src/queries/invoice-templates.ts invoice-gen/extracted/packages/db/src/queries/
cp packages/db/src/queries/customers.ts invoice-gen/extracted/packages/db/src/queries/
cp packages/db/src/queries/teams.ts invoice-gen/extracted/packages/db/src/queries/
cp packages/db/src/queries/users.ts invoice-gen/extracted/packages/db/src/queries/
cp packages/db/src/queries/tracker-projects.ts invoice-gen/extracted/packages/db/src/queries/
cp packages/db/src/queries/tracker-entries.ts invoice-gen/extracted/packages/db/src/queries/
cp packages/db/src/queries/customer-analytics.ts invoice-gen/extracted/packages/db/src/queries/

mkdir -p invoice-gen/extracted/apps/dashboard/src/components
mkdir -p invoice-gen/extracted/apps/dashboard/src/hooks
mkdir -p invoice-gen/extracted/apps/dashboard/src/store
mkdir -p invoice-gen/extracted/apps/dashboard/src/trpc
mkdir -p invoice-gen/extracted/apps/dashboard/src/lib
mkdir -p invoice-gen/extracted/apps/dashboard/src/utils
mkdir -p invoice-gen/extracted/apps/dashboard/src/actions

rsync -a apps/dashboard/src/components/invoice invoice-gen/extracted/apps/dashboard/src/components/
rsync -a apps/dashboard/src/components/tables/invoices invoice-gen/extracted/apps/dashboard/src/components/tables/
rsync -a apps/dashboard/src/components/sheets/invoice-details-sheet.tsx invoice-gen/extracted/apps/dashboard/src/components/sheets/
rsync -a apps/dashboard/src/components/sheets/invoice-sheet.tsx invoice-gen/extracted/apps/dashboard/src/components/sheets/

for f in \
  apps/dashboard/src/components/invoice-status.tsx \
  apps/dashboard/src/components/invoice-content.tsx \
  apps/dashboard/src/components/invoice-summary.tsx \
  apps/dashboard/src/components/invoice-column-visibility.tsx \
  apps/dashboard/src/components/open-invoice-sheet.tsx \
  apps/dashboard/src/components/invoice-header.tsx \
  apps/dashboard/src/components/invoice-actions.tsx \
  apps/dashboard/src/components/invoice-details.tsx \
  apps/dashboard/src/components/invoice-details-skeleton.tsx \
  apps/dashboard/src/components/invoice-note.tsx \
  apps/dashboard/src/components/invoice-sheet-header.tsx \
  apps/dashboard/src/components/invoice-payment-score.tsx \
  apps/dashboard/src/components/invoice-search-filter.tsx \
  apps/dashboard/src/components/invoice-success.tsx \
  apps/dashboard/src/components/invoices-open.tsx \
  apps/dashboard/src/components/invoices-overdue.tsx \
  apps/dashboard/src/components/invoices-paid.tsx \
  apps/dashboard/src/components/invoice-toolbar.tsx; do
  cp "$f" invoice-gen/extracted/apps/dashboard/src/components/
done

cp apps/dashboard/src/hooks/use-invoice-params.ts invoice-gen/extracted/apps/dashboard/src/hooks/
cp apps/dashboard/src/hooks/use-invoice-filter-params.ts invoice-gen/extracted/apps/dashboard/src/hooks/
cp apps/dashboard/src/hooks/use-sort-params.ts invoice-gen/extracted/apps/dashboard/src/hooks/
cp apps/dashboard/src/store/invoice.ts invoice-gen/extracted/apps/dashboard/src/store/
cp apps/dashboard/src/trpc/client.tsx invoice-gen/extracted/apps/dashboard/src/trpc/
cp apps/dashboard/src/trpc/query-client.ts invoice-gen/extracted/apps/dashboard/src/trpc/
cp apps/dashboard/src/lib/download.ts invoice-gen/extracted/apps/dashboard/src/lib/
cp apps/dashboard/src/utils/environment.ts invoice-gen/extracted/apps/dashboard/src/utils/
cp apps/dashboard/src/utils/logos.ts invoice-gen/extracted/apps/dashboard/src/utils/
cp apps/dashboard/src/utils/format.ts invoice-gen/extracted/apps/dashboard/src/utils/
cp apps/dashboard/src/utils/constants.ts invoice-gen/extracted/apps/dashboard/src/utils/
cp apps/dashboard/src/actions/update-column-visibility-action.ts invoice-gen/extracted/apps/dashboard/src/actions/

mkdir -p 'invoice-gen/extracted/apps/dashboard/src/app/[locale]/(app)/(sidebar)/invoices'
mkdir -p 'invoice-gen/extracted/apps/dashboard/src/app/[locale]/(app)/(sidebar)/invoices/products'
mkdir -p 'invoice-gen/extracted/apps/dashboard/src/app/[locale]/(public)/i/[token]'
mkdir -p 'invoice-gen/extracted/apps/dashboard/src/app/api/download/invoice'
cp 'apps/dashboard/src/app/[locale]/(app)/(sidebar)/invoices/page.tsx' 'invoice-gen/extracted/apps/dashboard/src/app/[locale]/(app)/(sidebar)/invoices/'
cp 'apps/dashboard/src/app/[locale]/(app)/(sidebar)/invoices/products/page.tsx' 'invoice-gen/extracted/apps/dashboard/src/app/[locale]/(app)/(sidebar)/invoices/products/'
cp 'apps/dashboard/src/app/[locale]/(public)/i/[token]/page.tsx' 'invoice-gen/extracted/apps/dashboard/src/app/[locale]/(public)/i/[token]/'
cp 'apps/dashboard/src/app/[locale]/(public)/i/[token]/opengraph-image.tsx' 'invoice-gen/extracted/apps/dashboard/src/app/[locale]/(public)/i/[token]/'
cp 'apps/dashboard/src/app/api/download/invoice/route.ts' 'invoice-gen/extracted/apps/dashboard/src/app/api/download/invoice/'

rg --files invoice-gen/extracted > invoice-gen/extracted/FILES.txt
echo "Extraction complete: invoice-gen/extracted"
