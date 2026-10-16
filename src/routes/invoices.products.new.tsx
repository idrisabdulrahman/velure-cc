import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import { Switch } from "#/components/ui/switch";
import { Textarea } from "#/components/ui/textarea";
import { toast } from "#/components/ui/use-toast";
import type { FormState } from "#/features/products/product-form-utils";
import {
	Field,
	UNIT_OPTIONS,
	validateProductForm,
} from "#/features/products/product-form-utils";
import { useUnifiedAuth } from "#/lib/auth-hook";
import { useSupabaseSession } from "#/lib/supabase-session";
import { createProduct } from "#/server/data/products";

export const Route = createFileRoute("/invoices/products/new")({
	component: NewProductPage,
});

const initialState: FormState = {
	type: "product",
	name: "",
	description: "",
	sku: "",
	unitName: "pcs",
	defaultUnitPrice: "",
	defaultTaxId: "",
	isActive: true,
};

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
	return new Promise<T>((resolve, reject) => {
		const timeoutId = window.setTimeout(() => {
			reject(
				new Error(
					"Product creation timed out. Check your connection and try again.",
				),
			);
		}, timeoutMs);

		promise.then(
			(value) => {
				window.clearTimeout(timeoutId);
				resolve(value);
			},
			(error: unknown) => {
				window.clearTimeout(timeoutId);
				reject(error);
			},
		);
	});
}

function NewProductPage() {
	const navigate = useNavigate();
	const authState = useUnifiedAuth();
	const userId = authState.data?.user?.id;
	const { client: supabaseClient } = useSupabaseSession(userId);
	const [state, setState] = useState<FormState>(initialState);
	const [submitting, setSubmitting] = useState(false);
	const [attemptedSubmit, setAttemptedSubmit] = useState(false);

	const { parsedUnitPrice, visibleNameError, visiblePriceError, isValid } =
		validateProductForm(state, attemptedSubmit);
	const previewUnitPrice = Number(state.defaultUnitPrice);
	const hasPreviewUnitPrice =
		state.defaultUnitPrice.trim().length > 0 &&
		Number.isFinite(previewUnitPrice) &&
		previewUnitPrice >= 0;

	const inputClass =
		"h-10 rounded-md border-rule bg-paper text-sm text-ink placeholder:text-ink-3 focus-visible:border-brand-line focus-visible:ring-0";

	const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setAttemptedSubmit(true);
		if (!isValid || submitting || !supabaseClient || !userId) return;

		setSubmitting(true);
		try {
			const trimmedName = state.name.trim();
			await withTimeout(
				createProduct(supabaseClient, userId, {
					type: state.type,
					name: trimmedName,
					description: state.description.trim() || undefined,
					sku: state.sku.trim() || undefined,
					unitName: state.unitName.trim() || undefined,
					defaultUnitPrice: parsedUnitPrice,
					defaultTaxId: state.defaultTaxId.trim() || undefined,
					isActive: state.isActive,
				}),
				20_000,
			);

			toast({
				title: "Product created",
				description: `${trimmedName} is now in your catalog.`,
				variant: "success",
			});
			void navigate({ to: "/invoices/products", replace: true });
		} catch (error) {
			toast({
				title: "Could not create product",
				description: error instanceof Error ? error.message : "Unknown error",
				variant: "error",
			});
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div className="flex h-full w-full flex-col gap-5">
			<div className="flex items-start justify-between gap-4">
				<div>
					<h1 className="text-[26px] font-medium tracking-[-0.02em] text-ink">
						New product
					</h1>
					<p className="mt-1 text-sm text-ink-3">
						Add a product or service to your catalog.
					</p>
				</div>
			</div>

			<div className="grid gap-4 lg:grid-cols-[1fr_320px]">
				<div className="rounded-md border border-rule bg-paper-2">
					<div className="p-4 md:p-5">
						<form onSubmit={onSubmit} className="space-y-4">
							<div className="grid gap-3 md:grid-cols-2">
								<Field label="Product type">
									<Select
										value={state.type}
										onValueChange={(value) =>
											setState((prev) => ({
												...prev,
												type: value as "product" | "service",
											}))
										}
									>
										<SelectTrigger className={`${inputClass} w-full`}>
											<SelectValue placeholder="Type" />
										</SelectTrigger>
										<SelectContent className="border-rule bg-paper-2 text-ink">
											<SelectItem value="product">Product</SelectItem>
											<SelectItem value="service">Service</SelectItem>
										</SelectContent>
									</Select>
								</Field>
								<Field label="Unit name">
									<Select
										value={state.unitName}
										onValueChange={(value) =>
											setState((prev) => ({ ...prev, unitName: value }))
										}
									>
										<SelectTrigger className={`${inputClass} w-full`}>
											<SelectValue placeholder="Unit" />
										</SelectTrigger>
										<SelectContent className="border-rule bg-paper-2 text-ink">
											{UNIT_OPTIONS.map((option) => (
												<SelectItem key={option.value} value={option.value}>
													{option.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</Field>
							</div>

							<Field label="Product name *" error={visibleNameError}>
								<Input
									value={state.name}
									onChange={(event) =>
										setState((prev) => ({ ...prev, name: event.target.value }))
									}
									className={inputClass}
									placeholder="e.g. Battery, Website Design"
								/>
							</Field>

							<Field label="Description">
								<Textarea
									rows={3}
									value={state.description}
									onChange={(event) =>
										setState((prev) => ({
											...prev,
											description: event.target.value,
										}))
									}
									className="resize-none rounded-md border-rule bg-paper text-sm text-ink placeholder:text-ink-3 focus-visible:border-brand-line focus-visible:ring-0"
									placeholder="Optional description"
								/>
							</Field>

							<div className="grid gap-3 md:grid-cols-2">
								<Field label="SKU">
									<Input
										value={state.sku}
										onChange={(event) =>
											setState((prev) => ({ ...prev, sku: event.target.value }))
										}
										className={inputClass}
										placeholder="Optional SKU"
									/>
								</Field>
								<Field label="Default unit price *" error={visiblePriceError}>
									<Input
										type="text"
										inputMode="decimal"
										value={state.defaultUnitPrice}
										onChange={(event) =>
											setState((prev) => ({
												...prev,
												defaultUnitPrice: event.target.value,
											}))
										}
										className={inputClass}
										placeholder="0.00"
									/>
								</Field>
							</div>

							<Field label="Default tax ID">
								<Input
									value={state.defaultTaxId}
									onChange={(event) =>
										setState((prev) => ({
											...prev,
											defaultTaxId: event.target.value,
										}))
									}
									className={inputClass}
									placeholder="Optional tax ID"
								/>
							</Field>

							<div className="inline-flex items-center gap-2 text-sm text-ink-2">
								<Switch
									checked={state.isActive}
									onCheckedChange={(checked) =>
										setState((prev) => ({ ...prev, isActive: checked }))
									}
									className="data-[state=checked]:bg-brand data-[state=unchecked]:bg-rule"
								/>
								<span>Active</span>
							</div>

							<div className="flex items-center justify-between border-t border-rule pt-4">
								<Button
									type="button"
									variant="outline"
									onClick={() => navigate({ to: "/invoices/products" })}
									className="h-10 rounded-md border-rule bg-transparent text-sm font-medium text-ink-2 hover:bg-paper-3 hover:text-ink"
								>
									Cancel
								</Button>
								<Button
									type="submit"
									disabled={!isValid || submitting}
									className="h-10 rounded-md bg-brand text-sm font-medium text-brand-ink hover:bg-brand-hi disabled:bg-brand-line disabled:text-ink-3"
								>
									{submitting ? "Creating..." : "Create product"}
								</Button>
							</div>
							<p className="text-xs text-ink-3">* Required fields</p>
						</form>
					</div>
				</div>

				<aside className="h-fit rounded-md border border-rule bg-paper-2 p-4">
					<h2 className="text-sm font-medium text-ink">Preview</h2>
					<div className="mt-3 rounded-md border border-rule bg-paper p-3 text-xs text-ink-2">
						<p className="font-medium text-ink">
							{state.name || "Product name"}
						</p>
						<p className="mt-1 capitalize">{state.type}</p>
						<p className="mt-1">
							{hasPreviewUnitPrice
								? `₦${previewUnitPrice.toLocaleString()}`
								: "₦0.00"}{" "}
							/ {state.unitName || "unit"}
						</p>
						{state.sku && <p className="mt-1">SKU: {state.sku}</p>}
						<p className="mt-1">
							Status: {state.isActive ? "Active" : "Inactive"}
						</p>
					</div>
				</aside>
			</div>
		</div>
	);
}
