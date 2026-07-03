import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import {
	buildProductIntelligence,
	buildProductSuggestions,
} from "./productIntelligence";
import { requireWorkspaceForRead, requireWritableWorkspace } from "./rls";

const productTypeValidator = v.union(
	v.literal("product"),
	v.literal("service"),
);

const createProductValidator = {
	type: productTypeValidator,
	name: v.string(),
	description: v.optional(v.string()),
	sku: v.optional(v.string()),
	unitName: v.optional(v.string()),
	defaultUnitPrice: v.number(),
	defaultTaxId: v.optional(v.string()),
	isActive: v.boolean(),
};

async function productIntelligenceInputs(
	ctx: QueryCtx,
	workspaceId: Id<"workspaces">,
) {
	const products = await ctx.db
		.query("products")
		.withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspaceId))
		.collect();

	const invoices = await ctx.db
		.query("invoices")
		.withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspaceId))
		.collect();

	return { products, invoices };
}

export const list = query({
	args: {
		q: v.optional(v.string()),
		type: v.optional(v.union(v.literal("all"), productTypeValidator)),
		status: v.optional(
			v.union(v.literal("all"), v.literal("active"), v.literal("archived")),
		),
	},
	handler: async (ctx, args) => {
		const scope = await requireWorkspaceForRead(ctx);
		if (!scope) return [];

		let products = await ctx.db
			.query("products")
			.withIndex("by_workspaceId", (q) =>
				q.eq("workspaceId", scope.workspaceId),
			)
			.collect();

		products = products.filter((p) => !p.deletedAt);

		if (args.type && args.type !== "all") {
			products = products.filter((p) => p.type === args.type);
		}

		if (args.status && args.status !== "all") {
			const isActive = args.status === "active";
			products = products.filter((p) => p.isActive === isActive);
		}

		const queryText = (args.q ?? "").toLowerCase().trim();
		if (queryText.length > 0) {
			products = products.filter((p) =>
				p.name.toLowerCase().includes(queryText),
			);
		}

		return products.map((p) => ({
			id: p._id,
			workspaceId: p.workspaceId,
			type: p.type,
			name: p.name,
			description: p.description,
			sku: p.sku,
			unitName: p.unitName,
			defaultUnitPrice: p.defaultUnitPrice,
			defaultTaxId: p.defaultTaxId,
			isActive: p.isActive,
			createdAt: p.createdAt,
			updatedAt: p.updatedAt,
		}));
	},
});

export const getById = query({
	args: { id: v.id("products") },
	handler: async (ctx, args) => {
		const scope = await requireWorkspaceForRead(ctx);
		if (!scope) return null;

		const product = await ctx.db.get(args.id);
		if (
			!product ||
			product.workspaceId !== scope.workspaceId ||
			product.deletedAt
		) {
			return null;
		}

		return {
			id: product._id,
			workspaceId: product.workspaceId,
			type: product.type,
			name: product.name,
			description: product.description,
			sku: product.sku,
			unitName: product.unitName,
			defaultUnitPrice: product.defaultUnitPrice,
			defaultTaxId: product.defaultTaxId,
			isActive: product.isActive,
			createdAt: product.createdAt,
			updatedAt: product.updatedAt,
		};
	},
});

export const search = query({
	args: { q: v.string() },
	handler: async (ctx, args) => {
		const scope = await requireWorkspaceForRead(ctx);
		if (!scope) return [];

		const queryText = args.q.toLowerCase().trim();
		if (queryText.length === 0) return [];

		let products = await ctx.db
			.query("products")
			.withIndex("by_workspaceId", (q) =>
				q.eq("workspaceId", scope.workspaceId),
			)
			.collect();

		products = products.filter(
			(p) =>
				!p.deletedAt &&
				p.isActive &&
				(p.name.toLowerCase().includes(queryText) ||
					p.sku?.toLowerCase().includes(queryText)),
		);

		products.sort((a, b) => a.name.localeCompare(b.name));

		return products.slice(0, 10).map((p) => ({
			id: p._id,
			name: p.name,
			sku: p.sku,
			defaultUnitPrice: p.defaultUnitPrice,
			unitName: p.unitName,
			type: p.type,
		}));
	},
});

export const create = mutation({
	args: createProductValidator,
	handler: async (ctx, args) => {
		const scope = await requireWritableWorkspace(ctx);

		if (args.name.trim().length < 1) {
			throw new Error("Product name is required.");
		}

		if (args.defaultUnitPrice < 0) {
			throw new Error("Unit price must be non-negative.");
		}

		const now = Date.now();

		const id = await ctx.db.insert("products", {
			workspaceId: scope.workspaceId,
			type: args.type,
			name: args.name.trim(),
			description: args.description?.trim() || undefined,
			sku: args.sku?.trim() || undefined,
			unitName: args.unitName?.trim() || undefined,
			defaultUnitPrice: args.defaultUnitPrice,
			defaultTaxId: args.defaultTaxId?.trim() || undefined,
			isActive: args.isActive,
			createdAt: now,
			updatedAt: now,
		});

		return id;
	},
});

export const update = mutation({
	args: {
		id: v.id("products"),
		...createProductValidator,
	},
	handler: async (ctx, args) => {
		const scope = await requireWritableWorkspace(ctx);

		const product = await ctx.db.get(args.id);
		if (
			!product ||
			product.workspaceId !== scope.workspaceId ||
			product.deletedAt
		) {
			throw new Error("Product not found.");
		}

		if (args.name.trim().length < 1) {
			throw new Error("Product name is required.");
		}

		if (args.defaultUnitPrice < 0) {
			throw new Error("Unit price must be non-negative.");
		}

		await ctx.db.patch(args.id, {
			type: args.type,
			name: args.name.trim(),
			description: args.description?.trim() || undefined,
			sku: args.sku?.trim() || undefined,
			unitName: args.unitName?.trim() || undefined,
			defaultUnitPrice: args.defaultUnitPrice,
			defaultTaxId: args.defaultTaxId?.trim() || undefined,
			isActive: args.isActive,
			updatedAt: Date.now(),
		});

		return args.id;
	},
});

export const archive = mutation({
	args: { id: v.id("products") },
	handler: async (ctx, args) => {
		const scope = await requireWritableWorkspace(ctx);

		const product = await ctx.db.get(args.id);
		if (
			!product ||
			product.workspaceId !== scope.workspaceId ||
			product.deletedAt
		) {
			throw new Error("Product not found.");
		}

		await ctx.db.patch(args.id, {
			isActive: false,
			deletedAt: Date.now(),
			updatedAt: Date.now(),
		});

		return args.id;
	},
});

export const duplicate = mutation({
	args: { id: v.id("products") },
	handler: async (ctx, args) => {
		const scope = await requireWritableWorkspace(ctx);

		const source = await ctx.db.get(args.id);
		if (
			!source ||
			source.workspaceId !== scope.workspaceId ||
			source.deletedAt
		) {
			throw new Error("Product not found.");
		}

		const now = Date.now();

		const id = await ctx.db.insert("products", {
			workspaceId: scope.workspaceId,
			type: source.type,
			name: `${source.name} (Copy)`,
			description: source.description,
			sku: source.sku,
			unitName: source.unitName,
			defaultUnitPrice: source.defaultUnitPrice,
			defaultTaxId: source.defaultTaxId,
			isActive: source.isActive,
			createdAt: now,
			updatedAt: now,
		});

		return id;
	},
});

export const getAnalytics = query({
	args: {},
	handler: async (ctx) => {
		const scope = await requireWorkspaceForRead(ctx);
		if (!scope) return [];

		const inputs = await productIntelligenceInputs(ctx, scope.workspaceId);
		return buildProductIntelligence(inputs).products;
	},
});

export const getIntelligence = query({
	args: {},
	handler: async (ctx) => {
		const scope = await requireWorkspaceForRead(ctx);
		if (!scope) return null;

		const inputs = await productIntelligenceInputs(ctx, scope.workspaceId);
		return buildProductIntelligence(inputs);
	},
});

export const getInsightById = query({
	args: { id: v.id("products") },
	handler: async (ctx, args) => {
		const scope = await requireWorkspaceForRead(ctx);
		if (!scope) return null;

		const product = await ctx.db.get(args.id);
		if (
			!product ||
			product.workspaceId !== scope.workspaceId ||
			product.deletedAt
		) {
			return null;
		}

		const inputs = await productIntelligenceInputs(ctx, scope.workspaceId);
		return (
			buildProductIntelligence(inputs).products.find(
				(metric) => metric.productId === args.id,
			) ?? null
		);
	},
});

export const getSuggestions = query({
	args: {
		clientName: v.optional(v.string()),
		currentProductIds: v.optional(v.array(v.id("products"))),
		limit: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		const scope = await requireWorkspaceForRead(ctx);
		if (!scope) return [];

		const inputs = await productIntelligenceInputs(ctx, scope.workspaceId);
		const intelligence = buildProductIntelligence(inputs);

		return buildProductSuggestions({
			intelligence,
			clientName: args.clientName,
			currentProductIds: args.currentProductIds,
			limit: args.limit,
		});
	},
});
