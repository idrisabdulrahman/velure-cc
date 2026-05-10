import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { assertValidTin, normalizeNigeriaPhone } from "./nigeria";
import { requireWritableClient, requireWritableWorkspace, requireWorkspaceForRead } from "./rls";

const statusValidator = v.union(
  v.literal("active"),
  v.literal("pending"),
  v.literal("inactive"),
  v.literal("archived"),
);

const contactValidator = v.object({
  fullName: v.optional(v.string()),
  role: v.optional(v.string()),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
});

const createClientValidator = {
  name: v.string(),
  company: v.optional(v.string()),
  email: v.string(),
  phone: v.optional(v.string()),
  website: v.optional(v.string()),
  billingAddress: v.optional(v.string()),
  taxId: v.optional(v.string()),
  currency: v.string(),
  paymentTerms: v.string(),
  internalNotes: v.optional(v.string()),
  contact: contactValidator,
  favorite: v.boolean(),
  status: statusValidator,
};

const normalize = (value?: string) => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const assertValidClientPayload = (input: {
  name: string;
  email: string;
  paymentTerms: string;
  currency: string;
  website?: string;
  contactEmail?: string;
}) => {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const paymentTerms = input.paymentTerms.trim();
  const currency = input.currency.trim();
  const contactEmail = input.contactEmail?.trim().toLowerCase();
  const website = input.website?.trim();

  if (name.length < 2) {
    throw new Error("Client name must be at least 2 characters long.");
  }

  if (!EMAIL_REGEX.test(email)) {
    throw new Error("Client email format is invalid.");
  }

  if (contactEmail && !EMAIL_REGEX.test(contactEmail)) {
    throw new Error("Contact email format is invalid.");
  }

  if (paymentTerms.length === 0) {
    throw new Error("Payment terms are required.");
  }

  if (currency.length === 0) {
    throw new Error("Currency is required.");
  }

  if (website) {
    try {
      // URL validation guard for server trust boundary.
      // We allow protocol-less user input by auto-prefixing https://.
      new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`);
    } catch {
      throw new Error("Website must be a valid URL.");
    }
  }
};

const assertEmailUnique = async (
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  email: string,
  idToIgnore?: Id<"clients">,
) => {
  const normalizedEmail = email.trim().toLowerCase();
  const duplicates = await ctx.db
    .query("clients")
    .withIndex("by_workspaceId_and_email", (q) =>
      q.eq("workspaceId", workspaceId).eq("email", normalizedEmail),
    )
    .collect();

  const conflict = duplicates.find((client) => client._id !== idToIgnore);
  if (conflict) {
    throw new Error("A client with this email already exists.");
  }
};

export const list = query({
  args: {
    q: v.optional(v.string()),
    status: v.optional(v.union(v.literal("all"), statusValidator)),
  },
  handler: async (ctx, args) => {
    const scope = await requireWorkspaceForRead(ctx);
    if (!scope) return [];

    let clients = await ctx.db
      .query("clients")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", scope.workspaceId))
      .order("desc")
      .collect();

    if (args.status && args.status !== "all") {
      clients = clients.filter((client) => client.status === args.status);
    }

    const queryText = (args.q ?? "").toLowerCase().trim();
    if (queryText.length > 0) {
      clients = clients.filter((client) => {
        const haystack = [
          client.name,
          client.company ?? "",
          client.email,
          client.contact.fullName ?? "",
        ]
          .join(" ")
          .toLowerCase();

        return haystack.includes(queryText);
      });
    }

    return clients.map((client) => ({
      id: client._id,
      workspaceId: client.workspaceId,
      name: client.name,
      company: client.company,
      email: client.email,
      phone: client.phone,
      website: client.website,
      billingAddress: client.billingAddress,
      taxId: client.taxId,
      currency: client.currency,
      paymentTerms: client.paymentTerms,
      internalNotes: client.internalNotes,
      contact: client.contact,
      favorite: client.favorite,
      status: client.status,
      createdAt: client.createdAt,
      updatedAt: client.updatedAt,
    }));
  },
});

export const getById = query({
  args: { id: v.id("clients") },
  handler: async (ctx, args) => {
    const scope = await requireWorkspaceForRead(ctx);
    if (!scope) return null;

    const client = await ctx.db.get(args.id);
    if (!client || client.workspaceId !== scope.workspaceId) return null;

    return {
      id: client._id,
      workspaceId: client.workspaceId,
      name: client.name,
      company: client.company,
      email: client.email,
      phone: client.phone,
      website: client.website,
      billingAddress: client.billingAddress,
      taxId: client.taxId,
      currency: client.currency,
      paymentTerms: client.paymentTerms,
      internalNotes: client.internalNotes,
      contact: client.contact,
      favorite: client.favorite,
      status: client.status,
      createdAt: client.createdAt,
      updatedAt: client.updatedAt,
    };
  },
});

export const create = mutation({
  args: createClientValidator,
  handler: async (ctx, args) => {
    const scope = await requireWritableWorkspace(ctx);
    assertValidClientPayload({
      name: args.name,
      email: args.email,
      paymentTerms: args.paymentTerms,
      currency: args.currency,
      website: args.website,
      contactEmail: args.contact.email,
    });
    assertValidTin(args.taxId);
    await assertEmailUnique(ctx, scope.workspaceId, args.email);

    const now = Date.now();

    const id = await ctx.db.insert("clients", {
      workspaceId: scope.workspaceId,
      ownerId: scope.userId,
      name: args.name.trim(),
      company: normalize(args.company),
      email: args.email.trim().toLowerCase(),
      phone: normalizeNigeriaPhone(args.phone),
      website: normalize(args.website),
      billingAddress: normalize(args.billingAddress),
      taxId: normalize(args.taxId),
      currency: args.currency.trim(),
      paymentTerms: args.paymentTerms.trim(),
      internalNotes: normalize(args.internalNotes),
      contact: {
        fullName: normalize(args.contact.fullName),
        role: normalize(args.contact.role),
        email: normalize(args.contact.email),
        phone: normalizeNigeriaPhone(args.contact.phone),
      },
      favorite: args.favorite,
      status: args.status,
      createdAt: now,
      updatedAt: now,
    });

    return id;
  },
});

export const importCsv = mutation({
  args: {
    clients: v.array(
      v.object({
        name: v.string(),
        company: v.optional(v.string()),
        email: v.string(),
        phone: v.optional(v.string()),
        billingAddress: v.optional(v.string()),
        taxId: v.optional(v.string()),
        currency: v.optional(v.string()),
        paymentTerms: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const scope = await requireWritableWorkspace(ctx);
    if (args.clients.length > 500) {
      throw new Error("Import supports up to 500 clients per CSV.");
    }

    let created = 0;
    let skipped = 0;
    const now = Date.now();

    for (const row of args.clients) {
      const email = row.email.trim().toLowerCase();
      const client = {
        name: row.name.trim(),
        email,
        paymentTerms: row.paymentTerms?.trim() || "Net 14",
        currency: row.currency?.trim().toUpperCase() || "NGN",
      };

      try {
        assertValidClientPayload(client);
        assertValidTin(row.taxId);
        await assertEmailUnique(ctx, scope.workspaceId, email);
      } catch {
        skipped += 1;
        continue;
      }

      await ctx.db.insert("clients", {
        workspaceId: scope.workspaceId,
        ownerId: scope.userId,
        name: client.name,
        company: normalize(row.company),
        email,
        phone: normalizeNigeriaPhone(row.phone),
        website: undefined,
        billingAddress: normalize(row.billingAddress),
        taxId: normalize(row.taxId),
        currency: client.currency,
        paymentTerms: client.paymentTerms,
        internalNotes: undefined,
        contact: {},
        favorite: false,
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      created += 1;
    }

    return { created, skipped };
  },
});

export const update = mutation({
  args: {
    id: v.id("clients"),
    ...createClientValidator,
  },
  handler: async (ctx, args) => {
    const { scope } = await requireWritableClient(ctx, args.id);
    assertValidClientPayload({
      name: args.name,
      email: args.email,
      paymentTerms: args.paymentTerms,
      currency: args.currency,
      website: args.website,
      contactEmail: args.contact.email,
    });
    assertValidTin(args.taxId);
    await assertEmailUnique(ctx, scope.workspaceId, args.email, args.id);

    await ctx.db.patch(args.id, {
      name: args.name.trim(),
      company: normalize(args.company),
      email: args.email.trim().toLowerCase(),
      phone: normalizeNigeriaPhone(args.phone),
      website: normalize(args.website),
      billingAddress: normalize(args.billingAddress),
      taxId: normalize(args.taxId),
      currency: args.currency.trim(),
      paymentTerms: args.paymentTerms.trim(),
      internalNotes: normalize(args.internalNotes),
      contact: {
        fullName: normalize(args.contact.fullName),
        role: normalize(args.contact.role),
        email: normalize(args.contact.email),
        phone: normalizeNigeriaPhone(args.contact.phone),
      },
      favorite: args.favorite,
      status: args.status,
      updatedAt: Date.now(),
    });

    return args.id;
  },
});

export const archive = mutation({
  args: { id: v.id("clients") },
  handler: async (ctx, args) => {
    await requireWritableClient(ctx, args.id);
    await ctx.db.patch(args.id, { status: "archived", updatedAt: Date.now() });
    return args.id;
  },
});

export const remove = mutation({
  args: { id: v.id("clients") },
  handler: async (ctx, args) => {
    await requireWritableClient(ctx, args.id);
    await ctx.db.delete(args.id);
    return args.id;
  },
});

export const toggleFavorite = mutation({
  args: { id: v.id("clients") },
  handler: async (ctx, args) => {
    const { client } = await requireWritableClient(ctx, args.id);

    const favorite = !client.favorite;
    await ctx.db.patch(args.id, { favorite, updatedAt: Date.now() });
    return favorite;
  },
});
