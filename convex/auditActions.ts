import { v } from "convex/values";

export const auditActionLiterals = [
	"invoice.created",
	"invoice.edited",
	"invoice.deleted",
	"invoice.renumbered",
	"invoice.paid",
	"invoice.partially_paid",
	"invoice.sent",
	"invoice.viewed",
	"invoice.converted",
	"invoice.schedule_canceled",
	"invoice.rescheduled",
	"collection.session.created",
	"collection.session.expired",
	"payment.initiated",
	"payment.received",
	"payment.failed",
	"reminder.sent",
	"oauth.connected",
	"integration.synced",
	"export.created",
	"export.retried",
	"workspace.changed",
	"workspace.selected",
] as const;

export type AuditAction = (typeof auditActionLiterals)[number];

export const auditActionValidator = v.union(
	...auditActionLiterals.map((action) => v.literal(action)),
);

export const auditResultValidator = v.union(
	v.literal("success"),
	v.literal("failure"),
);

export type AuditResult = "success" | "failure";
