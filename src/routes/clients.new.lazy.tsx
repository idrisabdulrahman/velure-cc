import { createLazyFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { useMemo, useState } from "react";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
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
import { api } from "../../convex/_generated/api";

export const Route = createLazyFileRoute("/clients/new")({
	component: NewClient,
});

type FormState = {
	name: string;
	company: string;
	email: string;
	phone: string;
	website: string;
	billingAddress: string;
	taxId: string;
	currency: string;
	paymentTerms: string;
	internalNotes: string;
	contactName: string;
	contactRole: string;
	contactEmail: string;
	contactPhone: string;
	favorite: boolean;
};

const initialState: FormState = {
	name: "",
	company: "",
	email: "",
	phone: "",
	website: "",
	billingAddress: "",
	taxId: "",
	currency: "NGN",
	paymentTerms: "Net 14",
	internalNotes: "",
	contactName: "",
	contactRole: "",
	contactEmail: "",
	contactPhone: "",
	favorite: false,
};

function NewClient() {
	const navigate = useNavigate();
	const createClient = useMutation(api.clients.create);
	const [state, setState] = useState<FormState>(initialState);
	const [submitting, setSubmitting] = useState(false);
	const [attemptedSubmit, setAttemptedSubmit] = useState(false);

	const nameError =
		state.name.trim().length === 0 ? "Client name is required" : "";
	const emailError =
		state.email.trim().length === 0
			? "Email is required"
			: /^\S+@\S+\.\S+$/.test(state.email.trim())
				? ""
				: "Please enter a valid email";
	const visibleNameError = attemptedSubmit ? nameError : "";
	const visibleEmailError =
		attemptedSubmit || state.email.trim() ? emailError : "";

	const isValid = !nameError && !emailError;

	const initials = useMemo(() => {
		const from = state.name || state.company || "VC";
		return from
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((part) => part[0]?.toUpperCase() ?? "")
			.join("");
	}, [state.company, state.name]);

	const inputClass =
		"h-10 rounded-md border-rule bg-paper text-sm text-ink placeholder:text-ink-3 focus-visible:border-accent-line focus-visible:ring-0";

	const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setAttemptedSubmit(true);
		if (!isValid || submitting) return;

		setSubmitting(true);
		try {
			await createClient({
				name: state.name,
				company: state.company || undefined,
				email: state.email,
				phone: state.phone || undefined,
				website: state.website || undefined,
				billingAddress: state.billingAddress || undefined,
				taxId: state.taxId || undefined,
				currency: state.currency,
				paymentTerms: state.paymentTerms,
				internalNotes: state.internalNotes || undefined,
				contact: {
					fullName: state.contactName || undefined,
					role: state.contactRole || undefined,
					email: state.contactEmail || undefined,
					phone: state.contactPhone || undefined,
				},
				favorite: state.favorite,
				status: "active",
			});

			toast({
				title: "Client created",
				description: `${state.name} is now available in Clients.`,
				variant: "success",
			});
			navigate({ to: "/clients" });
		} catch (error) {
			toast({
				title: "Could not create client",
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
						New client
					</h1>
					<p className="mt-1 text-sm text-ink-3">
						Add billing and contact details.
					</p>
				</div>
				<Button
					type="button"
					variant="outline"
					className="h-9 rounded-md border border-rule bg-paper-2 px-4 text-xs font-medium text-ink-2 transition-colors hover:border-rule hover:bg-paper-3 hover:text-ink"
				>
					Import
				</Button>
			</div>

			<div className="grid gap-4 lg:grid-cols-[1fr_320px]">
				<div className="flex max-h-[calc(100vh-7rem)] flex-col overflow-hidden rounded-md border border-rule bg-paper-2">
					<div className="flex-1 overflow-y-auto p-4 md:p-5">
						<form onSubmit={onSubmit} className="space-y-4">
							<div className="grid gap-3 md:grid-cols-2">
								<Field label="Client name *" error={visibleNameError}>
									<Input
										value={state.name}
										onChange={(event) =>
											setState((prev) => ({
												...prev,
												name: event.target.value,
											}))
										}
										className={inputClass}
										placeholder="Client name"
									/>
								</Field>
								<Field label="Company">
									<Input
										value={state.company}
										onChange={(event) =>
											setState((prev) => ({
												...prev,
												company: event.target.value,
											}))
										}
										className={inputClass}
										placeholder="Company"
									/>
								</Field>
								<Field label="Email *" error={visibleEmailError}>
									<Input
										value={state.email}
										onChange={(event) =>
											setState((prev) => ({
												...prev,
												email: event.target.value,
											}))
										}
										className={`${inputClass} ${visibleEmailError ? "border-danger" : ""}`}
										placeholder="Email"
									/>
								</Field>
								<Field label="Phone">
									<Input
										value={state.phone}
										onChange={(event) =>
											setState((prev) => ({
												...prev,
												phone: event.target.value,
											}))
										}
										className={inputClass}
										placeholder="+234 801 234 5678"
									/>
								</Field>
								<Field label="Website">
									<Input
										value={state.website}
										onChange={(event) =>
											setState((prev) => ({
												...prev,
												website: event.target.value,
											}))
										}
										className={inputClass}
										placeholder="Website"
									/>
								</Field>
								<Field label="TIN">
									<Input
										value={state.taxId}
										onChange={(event) =>
											setState((prev) => ({
												...prev,
												taxId: event.target.value,
											}))
										}
										className={inputClass}
										placeholder="10-digit TIN"
									/>
								</Field>
								<Field label="Currency">
									<Select
										value={state.currency}
										onValueChange={(value) =>
											setState((prev) => ({ ...prev, currency: value }))
										}
									>
										<SelectTrigger className={`${inputClass} w-full`}>
											<SelectValue placeholder="Currency" />
										</SelectTrigger>
										<SelectContent className="border-rule bg-paper-2 text-ink">
											<SelectItem value="NGN">NGN</SelectItem>
											<SelectItem value="USD">USD</SelectItem>
											<SelectItem value="GBP">GBP</SelectItem>
										</SelectContent>
									</Select>
								</Field>
								<Field label="Payment Terms">
									<Select
										value={state.paymentTerms}
										onValueChange={(value) =>
											setState((prev) => ({ ...prev, paymentTerms: value }))
										}
									>
										<SelectTrigger className={`${inputClass} w-full`}>
											<SelectValue placeholder="Payment Terms" />
										</SelectTrigger>
										<SelectContent className="border-rule bg-paper-2 text-ink">
											<SelectItem value="Due on receipt">
												Due on receipt
											</SelectItem>
											<SelectItem value="Net 7">Net 7</SelectItem>
											<SelectItem value="Net 14">Net 14</SelectItem>
											<SelectItem value="Net 30">Net 30</SelectItem>
										</SelectContent>
									</Select>
								</Field>
							</div>

							<Field label="Billing Address">
								<Textarea
									rows={3}
									value={state.billingAddress}
									onChange={(event) =>
										setState((prev) => ({
											...prev,
											billingAddress: event.target.value,
										}))
									}
									className="resize-none rounded-md border-rule bg-paper text-sm text-ink placeholder:text-ink-3 focus-visible:border-accent-line focus-visible:ring-0"
									placeholder="Billing Address"
								/>
							</Field>

							<Field label="Internal Notes">
								<Textarea
									rows={3}
									value={state.internalNotes}
									onChange={(event) =>
										setState((prev) => ({
											...prev,
											internalNotes: event.target.value,
										}))
									}
									className="resize-none rounded-md border-rule bg-paper text-sm text-ink placeholder:text-ink-3 focus-visible:border-accent-line focus-visible:ring-0"
									placeholder="Internal Notes"
								/>
							</Field>

							<section className="rounded-md border border-rule bg-paper p-3 md:p-4">
								<h2 className="mb-3 text-sm font-medium text-ink">
									Contact person
								</h2>
								<div className="grid gap-3 md:grid-cols-2">
									<Input
										value={state.contactName}
										onChange={(event) =>
											setState((prev) => ({
												...prev,
												contactName: event.target.value,
											}))
										}
										className={inputClass}
										placeholder="Full name"
									/>
									<Input
										value={state.contactRole}
										onChange={(event) =>
											setState((prev) => ({
												...prev,
												contactRole: event.target.value,
											}))
										}
										className={inputClass}
										placeholder="Role"
									/>
									<Input
										value={state.contactEmail}
										onChange={(event) =>
											setState((prev) => ({
												...prev,
												contactEmail: event.target.value,
											}))
										}
										className={inputClass}
										placeholder="Contact email"
									/>
									<Input
										value={state.contactPhone}
										onChange={(event) =>
											setState((prev) => ({
												...prev,
												contactPhone: event.target.value,
											}))
										}
										className={inputClass}
										placeholder="Contact phone"
									/>
								</div>
							</section>

							<div className="inline-flex items-center gap-2 text-sm text-ink-2">
								<Switch
									checked={state.favorite}
									onCheckedChange={(checked) =>
										setState((prev) => ({ ...prev, favorite: checked }))
									}
									className="data-[state=checked]:bg-brand data-[state=unchecked]:bg-rule"
								/>
								<span>Save as favorite client</span>
							</div>

							<div className="flex items-center justify-between border-t border-rule pt-4">
								<Button
									type="button"
									variant="outline"
									onClick={() => navigate({ to: "/clients" })}
									className="h-10 rounded-md border-rule bg-transparent text-sm font-medium text-ink-2 hover:bg-paper-3 hover:text-ink"
								>
									Cancel
								</Button>
								<Button
									type="submit"
									disabled={!isValid || submitting}
									className="h-10 rounded-md bg-brand text-sm font-medium text-brand-ink hover:bg-brand-hi disabled:bg-brand-line disabled:text-ink-3"
								>
									{submitting ? "Creating..." : "Create client"}
								</Button>
							</div>
							<p className="text-xs text-ink-3">* Required fields</p>
						</form>
					</div>
				</div>

				<aside className="h-fit rounded-md border border-rule bg-paper-2 p-4">
					<h2 className="text-sm font-medium text-ink">Preview</h2>
					<div className="mt-3 flex items-center gap-3">
						<span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-paper-3 text-xs font-medium text-ink-2">
							{initials || "VC"}
						</span>
						<div>
							<p className="text-sm font-medium text-ink">
								{state.name || "Client name"}
							</p>
							<p className="text-xs text-ink-3">{state.company || "Company"}</p>
						</div>
					</div>
					<div className="mt-3 rounded-md border border-rule bg-paper p-3 text-xs text-ink-2">
						<p>Contact: {state.email || "—"}</p>
						<p>Payment terms: {state.paymentTerms}</p>
						<p>Currency: {state.currency}</p>
						<p>Favorite: {state.favorite ? "Yes" : "No"}</p>
					</div>
				</aside>
			</div>
		</div>
	);
}

function Field({
	label,
	error,
	children,
}: {
	label: string;
	error?: string;
	children: React.ReactNode;
}) {
	return (
		<div className="space-y-1.5">
			<Label className="text-xs text-ink-3">{label}</Label>
			{children}
			{error ? <p className="text-xs text-danger">{error}</p> : null}
		</div>
	);
}
