export type IntegrationProvider = "quickbooks" | "xero" | "slack";

export type SyncStatus =
	| "idle"
	| "pending"
	| "success"
	| "failed"
	| "needs_configuration";

export type ProviderSyncState = {
	externalId?: string;
	status: SyncStatus;
	lastSyncedAt?: number;
	lastError?: string;
};

export type InvoiceSyncSnapshot = {
	quickbooks: ProviderSyncState;
	xero: ProviderSyncState;
	slack: ProviderSyncState;
};
