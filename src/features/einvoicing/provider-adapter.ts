import type { CanonicalInvoice } from "./canonical-invoice";
import type { CanonicalInvoiceValidation } from "./validate-canonical-invoice";

export type ProviderEnvironment = "sandbox" | "production";
export type ProviderMetadata = Readonly<{
	provider: string;
	environment: ProviderEnvironment;
	mock: boolean;
}>;

export type ProviderValidationResult = ProviderMetadata &
	Readonly<{
		operation: "validate";
		invoiceId: string;
		preSubmissionValid: boolean;
		issues: CanonicalInvoiceValidation["issues"];
	}>;

export type ProviderSubmissionOutcome =
	| "accepted"
	| "cleared"
	| "rejected"
	| "timeout"
	| "duplicate";

export type ProviderSubmissionResult = ProviderMetadata &
	Readonly<{
		operation: "submit";
		outcome: ProviderSubmissionOutcome;
		reference: string;
		issues?: CanonicalInvoiceValidation["issues"];
		rejectionCode?: string;
		mockClearance?: Readonly<{ irn: string; qrPayload: string }>;
	}>;

export type ProviderStatus =
	| "submitted"
	| "cleared"
	| "rejected"
	| "timeout"
	| "duplicate"
	| "cancelled"
	| "credited"
	| "unknown";

export type ProviderStatusResult = ProviderMetadata &
	Readonly<{
		operation: "getStatus";
		reference: string;
		status: ProviderStatus;
	}>;

export type ProviderActionResult = ProviderMetadata &
	Readonly<{
		operation: "cancel" | "credit";
		outcome: "accepted" | "rejected" | "not_found";
		reference: string;
		correctionId?: string;
		reason?: string;
	}>;

export type ProviderAdapter = Readonly<{
	validate(
		invoice: CanonicalInvoice,
		validation: CanonicalInvoiceValidation,
	): Promise<ProviderValidationResult>;
	submit(input: {
		invoice: CanonicalInvoice;
		validation: CanonicalInvoiceValidation;
		idempotencyKey: string;
	}): Promise<ProviderSubmissionResult>;
	getStatus(reference: string): Promise<ProviderStatusResult>;
	cancel(reference: string): Promise<ProviderActionResult>;
	credit(
		reference: string,
		correction: CanonicalInvoice,
	): Promise<ProviderActionResult>;
}>;

export type MockScenario =
	| "success"
	| "cleared"
	| "rejection"
	| "timeout"
	| "duplicate";

type StoredMockSubmission = {
	result: ProviderSubmissionResult;
	status: ProviderStatus;
	invoiceId: string;
};

const MOCK_METADATA = {
	provider: "mock",
	environment: "sandbox",
	mock: true,
} as const;

function clone<T>(value: T): T {
	return structuredClone(value);
}

function referenceFor(idempotencyKey: string): string {
	let hash = 14_695_981_039_346_656_037n;
	for (const character of idempotencyKey) {
		hash ^= BigInt(character.codePointAt(0) ?? 0);
		hash = (hash * 1_099_511_628_211n) & 0xffff_ffff_ffff_ffffn;
	}
	return `mock-${hash.toString(16).padStart(16, "0")}`;
}

function mockClearanceFor(reference: string) {
	const irn = `MOCK-IRN-${reference}`;
	return {
		irn,
		qrPayload: `MOCK-SANDBOX|NOT-NRS-CLEARED|IRN=${irn}|REFERENCE=${reference}`,
	};
}

/**
 * Deterministic, in-process adapter for contract work only. Its maps are
 * volatile instance state; no invoice or lifecycle value is written.
 */
export function createMockProviderAdapter(
	options: Readonly<{ scenario?: MockScenario }> = {},
): ProviderAdapter {
	const scenario = options.scenario ?? "success";
	const byKey = new Map<string, StoredMockSubmission>();
	const byReference = new Map<string, StoredMockSubmission>();

	return {
		async validate(invoice, validation) {
			return {
				...MOCK_METADATA,
				operation: "validate",
				invoiceId: invoice.id,
				preSubmissionValid: validation.valid,
				issues: clone(validation.issues),
			};
		},
		async submit({ invoice, validation, idempotencyKey }) {
			const key = idempotencyKey.trim();
			const existing = byKey.get(key);
			if (existing) {
				if (existing.invoiceId === invoice.id) return clone(existing.result);
				return {
					...MOCK_METADATA,
					operation: "submit",
					outcome: "duplicate",
					reference: existing.result.reference,
					rejectionCode: "IDEMPOTENCY_KEY_REUSED",
				};
			}

			const reference = referenceFor(key || `missing-${invoice.id}`);
			let outcome: ProviderSubmissionOutcome;
			let status: ProviderStatus;
			let issues: CanonicalInvoiceValidation["issues"] | undefined;
			let rejectionCode: string | undefined;
			if (!key || !validation.valid) {
				outcome = "rejected";
				status = "rejected";
				rejectionCode = key
					? "LOCAL_VALIDATION_FAILED"
					: "IDEMPOTENCY_KEY_REQUIRED";
				issues = clone(validation.issues);
			} else {
				outcome =
					scenario === "success"
						? "accepted"
						: scenario === "cleared"
							? "cleared"
							: scenario === "rejection"
								? "rejected"
								: scenario;
				status =
					scenario === "success"
						? "submitted"
						: scenario === "cleared"
							? "cleared"
							: scenario === "rejection"
								? "rejected"
								: scenario;
				if (scenario === "rejection") rejectionCode = "BUYER_TIN_INVALID";
			}
			const result: ProviderSubmissionResult = {
				...MOCK_METADATA,
				operation: "submit",
				outcome,
				reference,
				...(issues ? { issues } : {}),
				...(rejectionCode ? { rejectionCode } : {}),
				...(outcome === "cleared"
					? { mockClearance: mockClearanceFor(reference) }
					: {}),
			};
			const stored = { result, status, invoiceId: invoice.id };
			if (key) byKey.set(key, stored);
			byReference.set(reference, stored);
			return clone(result);
		},
		async getStatus(reference) {
			return {
				...MOCK_METADATA,
				operation: "getStatus",
				reference,
				status: byReference.get(reference)?.status ?? "unknown",
			};
		},
		async cancel(reference) {
			const stored = byReference.get(reference);
			if (!stored)
				return {
					...MOCK_METADATA,
					operation: "cancel",
					outcome: "not_found",
					reference,
				};
			stored.status = "cancelled";
			return {
				...MOCK_METADATA,
				operation: "cancel",
				outcome: "accepted",
				reference,
			};
		},
		async credit(reference, correction) {
			const stored = byReference.get(reference);
			if (!stored)
				return {
					...MOCK_METADATA,
					operation: "credit",
					outcome: "not_found",
					reference,
				};
			const isCorrection =
				correction.documentType === "credit_note" ||
				correction.documentType === "debit_note";
			const hasSource = correction.relatedDocuments?.some(
				(document) =>
					document.relation === "corrects" &&
					document.documentId === stored.invoiceId,
			);
			if (!isCorrection || !hasSource)
				return {
					...MOCK_METADATA,
					operation: "credit",
					outcome: "rejected",
					reference,
					reason: "A linked credit or debit note is required.",
				};
			stored.status = "credited";
			return {
				...MOCK_METADATA,
				operation: "credit",
				outcome: "accepted",
				reference,
				correctionId: correction.id,
			};
		},
	};
}
