import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { Loader2 } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
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
import { formatMoney } from "#/features/invoices/format";
import type { FormState } from "#/features/products/product-form-utils";
import {
	Field,
	UNIT_OPTIONS,
	validateProductForm,
} from "#/features/products/product-form-utils";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

export const Route = createFileRoute("/invoices/products/$id")({
	component: ProductDetailPage,
});

function ProductDetailPage() {
	const { id } = Route.useParams();
	const navigate = useNavigate();
	const updateProduct = useMutation(api.products.update);
	const { data: product, isPending } = useQuery(
		convexQuery(api.products.getById, { id: id as Id<"products"> }),
	);
	const [state, setState] = useState<FormState | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const [attemptedSubmit, setAttemptedSubmit] = useState(false);

	useEffect(() => {
		if (!product) return;
		setState({
			type: product.type,
			name: product.name,
			description: product.description ?? "",
			sku: product.sku ?? "",
			unitName: product.unitName ?? "unit",
			defaultUnitPrice: String(product.defaultUnitPrice),
			defaultTaxId: product.defaultTaxId ?? "",
			isActive: product.isActive,
		});
		setAttemptedSubmit(false);
	}, [product]);

	if (isPending) {
		return (
			<div className="flex h-full items-center justify-center">
				<div className="flex items-center gap-2 text-sm text-[#817d72]">
					<Loader2 className="h-5 w-5 animate-spin text-[#c8ff62]" />
					<span>Loading product details</span>
				</div>
			</div>
		);
	}

	if (!product || !state) {
		return (
			<div className="flex h-full items-center justify-center">
				<div className="text-center">
					<p className="text-sm font-medium text-[#f2efe7]">
						Product not found
					</p>
					<button
						type="button"
						onClick={() => navigate({ to: "/invoices/products" })}
						className="mt-2 text-sm text-[#c8ff62] hover:text-[#d5ff7a]"
					>
						Back to products
					</button>
				</div>
			</div>
		);
	}

	const { parsedUnitPrice, visibleNameError, visiblePriceError, isValid } =
		validateProductForm(state, attemptedSubmit);
	const inputClass =
		"h-10 rounded-md border-[#30352f] bg-[#0f1111] text-sm text-[#f2efe7] placeholder:text-[#737b89] focus-visible:border-[#c8ff62] focus-visible:ring-0";

	const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setAttemptedSubmit(true);
		if (!isValid || submitting) return;

		setSubmitting(true);
		try {
			const trimmedName = state.name.trim();
			await updateProduct({
				id: id as Id<"products">,
				type: state.type,
				name: trimmedName,
				description: state.description.trim() || undefined,
				sku: state.sku.trim() || undefined,
				unitName: state.unitName.trim() || undefined,
				defaultUnitPrice: parsedUnitPrice,
				defaultTaxId: state.defaultTaxId.trim() || undefined,
				isActive: state.isActive,
			});

			toast({
				title: "Product updated",
				description: `${trimmedName} is ready for future invoices.`,
				variant: "success",
			});
		} catch (error) {
			toast({
				title: "Could not update product",
				description: error instanceof Error ? error.message : "Unknown error",
				variant: "error",
			});
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div className="flex h-full w-full flex-col gap-6">
			<div className="flex items-start justify-between gap-4">
				<div>
					<button
						type="button"
						onClick={() => navigate({ to: "/invoices/products" })}
						className="mb-2 text-sm text-[#817d72] hover:text-[#f2efe7]"
					>
						← Back to products
					</button>
					<h1 className="text-[26px] font-medium tracking-[-0.02em] text-[#f2efe7]">
						{product.name}
					</h1>
					<p className="mt-1 text-sm text-[#8d938f]">
						Edit catalog details used on future invoices.
					</p>
				</div>
				<span
					className={`inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium ${
						product.isActive
							? "border-[#425033] bg-[#1e2418] text-[#b7ca7c]"
							: "border-[#5d4747] bg-[#261c1c] text-[#d4a0a0]"
					}`}
				>
					{product.isActive ? "Active" : "Archived"}
				</span>
			</div>

			<div className="grid gap-6 lg:grid-cols-2">
				<div className="ui-panel rounded-md border border-[#30352f] bg-[#171a18]">
					<div className="border-b border-[#30352f] px-5 py-4">
						<h2 className="text-sm font-medium text-[#f2efe7]">
							Product information
						</h2>
						<p className="mt-1 text-xs text-[#817d72]">
							Updates change the catalog default, not past invoices.
						</p>
					</div>
					<form onSubmit={onSubmit} className="space-y-4 p-5">
						<div className="grid gap-3 md:grid-cols-2">
							<Field label="Product type">
								<Select
									value={state.type}
									onValueChange={(value) =>
										setState((prev) =>
											prev
												? { ...prev, type: value as "product" | "service" }
												: prev,
										)
									}
								>
									<SelectTrigger className={`${inputClass} w-full`}>
										<SelectValue placeholder="Type" />
									</SelectTrigger>
									<SelectContent className="border-[#30352f] bg-[#171a18] text-[#f2efe7]">
										<SelectItem value="product">Product</SelectItem>
										<SelectItem value="service">Service</SelectItem>
									</SelectContent>
								</Select>
							</Field>
							<Field label="Unit name">
								<Select
									value={state.unitName}
									onValueChange={(value) =>
										setState((prev) =>
											prev ? { ...prev, unitName: value } : prev,
										)
									}
								>
									<SelectTrigger className={`${inputClass} w-full`}>
										<SelectValue placeholder="Unit" />
									</SelectTrigger>
									<SelectContent className="border-[#30352f] bg-[#171a18] text-[#f2efe7]">
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
									setState((prev) =>
										prev ? { ...prev, name: event.target.value } : prev,
									)
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
									setState((prev) =>
										prev ? { ...prev, description: event.target.value } : prev,
									)
								}
								className="resize-none rounded-md border-[#30352f] bg-[#0f1111] text-sm text-[#f2efe7] placeholder:text-[#737b89] focus-visible:border-[#c8ff62] focus-visible:ring-0"
								placeholder="Optional description"
							/>
						</Field>

						<div className="grid gap-3 md:grid-cols-2">
							<Field label="SKU">
								<Input
									value={state.sku}
									onChange={(event) =>
										setState((prev) =>
											prev ? { ...prev, sku: event.target.value } : prev,
										)
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
										setState((prev) =>
											prev
												? { ...prev, defaultUnitPrice: event.target.value }
												: prev,
										)
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
									setState((prev) =>
										prev ? { ...prev, defaultTaxId: event.target.value } : prev,
									)
								}
								className={inputClass}
								placeholder="Optional tax ID"
							/>
						</Field>

						<div className="inline-flex items-center gap-2 text-sm text-[#d8d1c4]">
							<Switch
								checked={state.isActive}
								onCheckedChange={(checked) =>
									setState((prev) =>
										prev ? { ...prev, isActive: checked } : prev,
									)
								}
								className="data-[state=checked]:bg-[#c8ff62] data-[state=unchecked]:bg-[#30352f]"
							/>
							<span>Active in catalog</span>
						</div>

						<div className="flex items-center justify-between border-t border-[#30352f] pt-4">
							<Button
								type="button"
								variant="outline"
								onClick={() => navigate({ to: "/invoices/products" })}
								className="h-10 rounded-md border-[#30352f] bg-transparent text-sm font-medium text-[#d8d1c4] hover:bg-[#20241f] hover:text-[#f2efe7]"
							>
								Cancel
							</Button>
							<Button
								type="submit"
								disabled={!isValid || submitting}
								className="h-10 rounded-md bg-[#c8ff62] text-sm font-medium text-[#0f1111] hover:bg-[#d5ff7a] disabled:bg-[#3f5130] disabled:text-[#817d72]"
							>
								{submitting ? "Saving..." : "Save product"}
							</Button>
						</div>
						<p className="text-xs text-[#8d938f]">* Required fields</p>
					</form>
				</div>

				<div className="ui-panel rounded-md border border-[#30352f] bg-[#171a18] p-5">
					<h2 className="text-sm font-medium text-[#f2efe7]">
						Catalog summary
					</h2>
					<div className="mt-4 rounded-md border border-[#30352f] bg-[#0f1111] p-4">
						<p className="text-sm font-medium text-[#f2efe7]">
							{state.name || "Product name"}
						</p>
						<p className="mt-1 text-xs capitalize text-[#817d72]">
							{state.type} / {state.unitName || "unit"}
						</p>
						<p className="mt-3 text-lg font-semibold text-[#f2efe7]">
							{Number.isFinite(parsedUnitPrice)
								? formatMoney(parsedUnitPrice, "NGN")
								: "₦0.00"}
						</p>
						{state.sku ? (
							<p className="mt-1 text-xs text-[#817d72]">SKU {state.sku}</p>
						) : null}
					</div>
					<div className="mt-4 grid grid-cols-2 gap-4">
						<div className="rounded-md border border-[#30352f] bg-[#0f1111] p-3">
							<p className="text-xs text-[#817d72]">Created</p>
							<p className="mt-1 text-sm font-medium text-[#f2efe7]">
								{new Date(product.createdAt).toLocaleDateString()}
							</p>
						</div>
						<div className="rounded-md border border-[#30352f] bg-[#0f1111] p-3">
							<p className="text-xs text-[#817d72]">Last updated</p>
							<p className="mt-1 text-sm font-medium text-[#f2efe7]">
								{new Date(product.updatedAt).toLocaleDateString()}
							</p>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
