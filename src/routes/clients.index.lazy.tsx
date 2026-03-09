import { createLazyFileRoute, Link } from '@tanstack/react-router'
import { MoreHorizontal, Pencil, Star, Trash2 } from 'lucide-react'
import { useMutation, useQuery } from 'convex/react'
import { useEffect, useMemo, useState } from 'react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import { Input } from '#/components/ui/input'
import { Badge } from '#/components/ui/badge'
import { Label } from '#/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { toast } from '#/components/ui/use-toast'

export const Route = createLazyFileRoute('/clients/')({
  component: ClientsIndex,
})

type ClientStatus = 'active' | 'pending' | 'inactive' | 'archived'

type ClientRow = {
  id: Id<'clients'>
  name: string
  company?: string
  email: string
  phone?: string
  website?: string
  billingAddress?: string
  taxId?: string
  currency: string
  paymentTerms: string
  internalNotes?: string
  contact: {
    fullName?: string
    role?: string
    email?: string
    phone?: string
  }
  favorite: boolean
  status: ClientStatus
  createdAt: number
  updatedAt: number
}

function ClientsIndex() {
  const updateClient = useMutation(api.clients.update)
  const archiveClient = useMutation(api.clients.archive)
  const removeClient = useMutation(api.clients.remove)
  const toggleFavorite = useMutation(api.clients.toggleFavorite)

  const [query, setQuery] = useState('')
  const clientsFromQuery =
    (useQuery(api.clients.list, { q: query, status: 'all' }) as ClientRow[] | undefined) ?? []

  const [clients, setClients] = useState<ClientRow[]>([])
  const [selectedId, setSelectedId] = useState<Id<'clients'> | null>(null)
  const [deleteTargetId, setDeleteTargetId] = useState<Id<'clients'> | null>(null)
  const [busyAction, setBusyAction] = useState<'update' | 'archive' | 'delete' | null>(
    null,
  )

  useEffect(() => {
    setClients(clientsFromQuery)
  }, [clientsFromQuery])

  useEffect(() => {
    if (!selectedId && clients.length > 0) {
      setSelectedId(clients[0].id)
    }

    if (selectedId && !clients.some((client) => client.id === selectedId)) {
      setSelectedId(clients[0]?.id ?? null)
    }
  }, [clients, selectedId])

  const selected = useMemo(
    () => clients.find((client) => client.id === selectedId) ?? null,
    [clients, selectedId],
  )

  const [editState, setEditState] = useState({
    name: '',
    email: '',
    company: '',
    paymentTerms: 'Net 14',
    status: 'active' as ClientStatus,
  })

  useEffect(() => {
    if (!selected) return
    setEditState({
      name: selected.name,
      email: selected.email,
      company: selected.company ?? '',
      paymentTerms: selected.paymentTerms,
      status: selected.status,
    })
  }, [selected])

  const updateDisabled =
    !selected || editState.name.trim().length === 0 || !/^\S+@\S+\.\S+$/.test(editState.email)

  const patchLocal = (id: Id<'clients'>, updater: (client: ClientRow) => ClientRow) => {
    setClients((prev) => prev.map((client) => (client.id === id ? updater(client) : client)))
  }

  const onUpdate = async () => {
    if (!selected || updateDisabled) return

    const snapshot = clients
    patchLocal(selected.id, (client) => ({
      ...client,
      name: editState.name,
      company: editState.company || undefined,
      email: editState.email,
      paymentTerms: editState.paymentTerms,
      status: editState.status,
      updatedAt: Date.now(),
    }))

    setBusyAction('update')
    try {
      await updateClient({
        id: selected.id,
        name: editState.name,
        company: editState.company || undefined,
        email: editState.email,
        phone: selected.phone,
        website: selected.website,
        billingAddress: selected.billingAddress,
        taxId: selected.taxId,
        currency: selected.currency,
        paymentTerms: editState.paymentTerms,
        internalNotes: selected.internalNotes,
        contact: selected.contact,
        favorite: selected.favorite,
        status: editState.status,
      })
      toast({ title: 'Client updated', variant: 'success' })
    } catch (error) {
      setClients(snapshot)
      toast({
        title: 'Update failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'error',
      })
    } finally {
      setBusyAction(null)
    }
  }

  const onArchive = async () => {
    if (!selected) return

    const snapshot = clients
    patchLocal(selected.id, (client) => ({
      ...client,
      status: 'archived',
      updatedAt: Date.now(),
    }))

    setBusyAction('archive')
    try {
      await archiveClient({ id: selected.id })
      toast({ title: 'Client archived', variant: 'success' })
    } catch (error) {
      setClients(snapshot)
      toast({
        title: 'Archive failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'error',
      })
    } finally {
      setBusyAction(null)
    }
  }

  const onDeleteConfirm = async () => {
    if (!deleteTargetId) return

    const snapshot = clients
    setClients((prev) => prev.filter((client) => client.id !== deleteTargetId))
    if (selectedId === deleteTargetId) {
      setSelectedId(null)
    }

    setBusyAction('delete')
    try {
      await removeClient({ id: deleteTargetId })
      toast({ title: 'Client deleted', variant: 'success' })
    } catch (error) {
      setClients(snapshot)
      toast({
        title: 'Delete failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'error',
      })
    } finally {
      setBusyAction(null)
      setDeleteTargetId(null)
    }
  }

  const onToggleFavorite = async () => {
    if (!selected) return

    const nextFavorite = !selected.favorite
    const snapshot = clients
    patchLocal(selected.id, (client) => ({
      ...client,
      favorite: nextFavorite,
      updatedAt: Date.now(),
    }))

    try {
      await toggleFavorite({ id: selected.id })
    } catch (error) {
      setClients(snapshot)
      toast({
        title: 'Favorite update failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'error',
      })
    }
  }

  return (
    <>
      <div className="flex h-full w-full flex-col gap-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-serif text-4xl font-medium italic text-[#F2F3F5] md:text-5xl">
              Clients
            </h1>
            <p className="mt-2 text-sm text-[#8A8F99]">
              Manage client records, billing preferences, and lifecycle status.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search clients..."
              className="h-10 w-[220px] rounded-[10px] border-[#1A1D22] bg-[#0D1016] text-sm text-[#F2F3F5] placeholder:text-[#7F8794] focus-visible:ring-0"
            />
            <Button
              asChild
              className="h-10 rounded-[10px] bg-[#C8FF1A] px-4 text-xs font-bold tracking-wide text-[#050607] hover:bg-[#d3ff4f]"
            >
              <Link to="/clients/new">+ NEW CLIENT</Link>
            </Button>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
          <Card className="overflow-hidden rounded-[10px] border-[#1A1D22] bg-[#0D1016]">
            <CardHeader className="border-b border-[#1A1D22] px-4 py-3 md:px-5">
              <CardTitle className="mb-0 text-sm font-semibold tracking-[0.04em] text-[#8A8F99]">
                CLIENT DIRECTORY
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table className="w-full">
                <TableHeader className="border-[#1A1D22]">
                  <TableRow className="border-[#1A1D22] hover:bg-transparent">
                    <TableHead className="h-11 border-r-0 px-4 text-[11px] font-semibold tracking-[0.04em] text-[#8A8F99] md:px-5">
                      CLIENT
                    </TableHead>
                    <TableHead className="h-11 border-r-0 text-[11px] font-semibold tracking-[0.04em] text-[#8A8F99]">
                      COMPANY
                    </TableHead>
                    <TableHead className="h-11 border-r-0 text-[11px] font-semibold tracking-[0.04em] text-[#8A8F99]">
                      EMAIL
                    </TableHead>
                    <TableHead className="h-11 border-r-0 text-[11px] font-semibold tracking-[0.04em] text-[#8A8F99]">
                      STATUS
                    </TableHead>
                    <TableHead className="h-11 border-r-0 text-[11px] font-semibold tracking-[0.04em] text-[#8A8F99]">
                      UPDATED
                    </TableHead>
                    <TableHead className="h-11 border-r-0 text-right text-[11px] font-semibold tracking-[0.04em] text-[#8A8F99]">
                      ACTIONS
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="border-[#1A1D22]">
                  {clients.map((client, index) => (
                    <TableRow
                      key={client.id}
                      className={`h-[66px] border-[#1A1D22] ${index % 2 === 1 ? 'bg-[#0F131A]' : ''} ${
                        selectedId === client.id ? 'bg-[#0F131A]' : ''
                      }`}
                    >
                      <TableCell className="border-r-0 px-4 md:px-5">
                        <button
                          type="button"
                          onClick={() => setSelectedId(client.id)}
                          className="truncate text-left text-[13px] text-[#F2F3F5] hover:text-white"
                        >
                          {client.name}
                        </button>
                      </TableCell>
                      <TableCell className="border-r-0 text-[13px] text-[#B8C0CF]">
                        {client.company ?? '—'}
                      </TableCell>
                      <TableCell className="border-r-0 text-[13px] text-[#B8C0CF]">
                        {client.email}
                      </TableCell>
                      <TableCell className="border-r-0">
                        <StatusChip status={client.status} />
                      </TableCell>
                      <TableCell className="border-r-0 text-xs text-[#8A8F99]">
                        {timeAgo(client.updatedAt)}
                      </TableCell>
                      <TableCell className="border-r-0 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 rounded-md border border-[#262B34] bg-[#0D1016]"
                            >
                              <MoreHorizontal className="h-3.5 w-3.5 text-[#7E8794]" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent className="border-[#1A1D22] bg-[#0D1016] text-[#F2F3F5]">
                            <DropdownMenuItem
                              className="gap-2 focus:bg-[#151A22]"
                              onClick={() => setSelectedId(client.id)}
                            >
                              <Pencil className="h-3.5 w-3.5" /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="gap-2 text-[#C77A7A] focus:bg-[#2A1515] focus:text-[#ffb0b0]"
                              onClick={() => setDeleteTargetId(client.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {clients.length === 0 ? (
                <div className="px-4 py-8 text-sm text-[#8A8F99]">No clients found.</div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="h-fit rounded-[10px] border-[#1A1D22] bg-[#0D1016]">
            <CardContent className="space-y-3 p-4">
              <h2 className="text-sm font-semibold text-[#C8FF1A]">Selected Client</h2>
              {!selected ? (
                <p className="text-sm text-[#8A8F99]">Select a client from the table.</p>
              ) : (
                <>
                  <h3 className="font-serif text-3xl italic text-[#F2F3F5]">
                    {selected.company || selected.name}
                  </h3>

                  <LabeledInput
                    label="Name"
                    value={editState.name}
                    onChange={(value) => setEditState((prev) => ({ ...prev, name: value }))}
                  />
                  <LabeledInput
                    label="Email"
                    value={editState.email}
                    onChange={(value) => setEditState((prev) => ({ ...prev, email: value }))}
                  />
                  <LabeledInput
                    label="Company"
                    value={editState.company}
                    onChange={(value) => setEditState((prev) => ({ ...prev, company: value }))}
                  />
                  <LabeledInput
                    label="Payment Terms"
                    value={editState.paymentTerms}
                    onChange={(value) =>
                      setEditState((prev) => ({ ...prev, paymentTerms: value }))
                    }
                  />

                  <div className="space-y-1.5">
                    <Label className="text-xs text-[#8A8F99]">Status</Label>
                    <Select
                      value={editState.status}
                      onValueChange={(value) =>
                        setEditState((prev) => ({ ...prev, status: value as ClientStatus }))
                      }
                    >
                      <SelectTrigger className="h-9 rounded-[10px] border-[#1A1D22] bg-[#0A0D12] text-xs text-[#F2F3F5]">
                        <SelectValue placeholder="Status" />
                      </SelectTrigger>
                      <SelectContent className="border-[#1A1D22] bg-[#0D1016] text-[#F2F3F5]">
                        <SelectItem value="active">active</SelectItem>
                        <SelectItem value="pending">pending</SelectItem>
                        <SelectItem value="inactive">inactive</SelectItem>
                        <SelectItem value="archived">archived</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2 border-t border-[#1A1D22] pt-3">
                    <Button
                      type="button"
                      onClick={() => void onUpdate()}
                      disabled={updateDisabled || busyAction !== null}
                      className="h-10 w-full rounded-[10px] bg-[#C8FF1A] text-sm font-bold text-[#050607] hover:bg-[#d3ff4f] disabled:bg-[#C8FF1A66]"
                    >
                      {busyAction === 'update' ? 'Updating...' : 'Update Data'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void onArchive()}
                      disabled={busyAction !== null}
                      className="h-10 w-full rounded-[10px] border-[#2A3038] bg-transparent text-sm font-semibold text-[#DCE1E8] hover:bg-[#141922]"
                    >
                      {busyAction === 'archive' ? 'Archiving...' : 'Archive Client'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setDeleteTargetId(selected.id)}
                      disabled={busyAction !== null}
                      className="h-10 w-full rounded-[10px] border-[#4A2A2A] bg-transparent text-sm font-semibold text-[#C77A7A] hover:bg-[#1b1212]"
                    >
                      Delete Client
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void onToggleFavorite()}
                      className="h-9 w-full rounded-[10px] border-[#1A1D22] bg-transparent text-xs text-[#8A8F99] hover:bg-[#141922]"
                    >
                      <Star className="mr-2 h-3.5 w-3.5" />
                      {selected.favorite ? 'Remove Favorite' : 'Save as Favorite'}
                    </Button>
                    <p className="text-[11px] leading-5 text-[#8A8F99]">
                      Deleting removes client history from quick access. This action requires
                      confirmation.
                    </p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <AlertDialog open={deleteTargetId !== null} onOpenChange={(open) => !open && setDeleteTargetId(null)}>
        <AlertDialogContent className="border-[#1A1D22] bg-[#0D1016] text-[#F2F3F5]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[#F2F3F5]">Delete client?</AlertDialogTitle>
            <AlertDialogDescription className="text-[#8A8F99]">
              This will permanently remove the client from your list.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-[#2A3038] bg-transparent text-[#DCE1E8] hover:bg-[#141922]">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void onDeleteConfirm()}
              className="bg-[#3d1f1f] text-[#ffb0b0] hover:bg-[#542929]"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function LabeledInput({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-[#8A8F99]">{label}</Label>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-[10px] border-[#1A1D22] bg-[#0A0D12] text-xs text-[#F2F3F5]"
      />
    </div>
  )
}

function StatusChip({ status }: { status: ClientStatus }) {
  if (status === 'active') {
    return (
      <Badge className="rounded-full border-[#2A351A] bg-[#131C0B] px-2.5 py-1 text-[10px] font-bold tracking-wide text-[#C8FF1A] hover:bg-[#131C0B]">
        ACTIVE
      </Badge>
    )
  }

  if (status === 'pending') {
    return (
      <Badge className="rounded-full border-[#3A2E1A] bg-[#1B150B] px-2.5 py-1 text-[10px] font-bold tracking-wide text-[#F5BA62] hover:bg-[#1B150B]">
        PENDING
      </Badge>
    )
  }

  return (
    <Badge className="rounded-full border-[#2B3038] bg-[#171A20] px-2.5 py-1 text-[10px] font-bold tracking-wide text-[#9AA2AF] hover:bg-[#171A20]">
      {status.toUpperCase()}
    </Badge>
  )
}

function timeAgo(timestamp: number) {
  const deltaMs = Date.now() - timestamp
  const minutes = Math.max(1, Math.floor(deltaMs / 60000))

  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  return `${weeks}w ago`
}
