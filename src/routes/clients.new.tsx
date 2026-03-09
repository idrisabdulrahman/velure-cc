import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { useMemo, useState } from "react";
import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
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

export const Route = createFileRoute("/clients/new")({
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
	currency: "USD",
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

	const nameError =
		state.name.trim().length === 0 ? "Client name is required" : "";
	const emailError = /^\S+@\S+\.\S+$/.test(state.email.trim())
		? ""
		: "Please enter a valid email";

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
		"h-11 rounded-[10px] border-[#1A1D22] bg-[#0A0D12] text-sm text-[#F2F3F5] placeholder:text-[#7F8794] focus-visible:ring-0 focus-visible:border-[#2F3540]";

	const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
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
					<h1 className="font-serif text-4xl font-medium italic text-[#F2F3F5] md:text-5xl">
						Create Client
					</h1>
					<p className="mt-2 text-sm text-[#8A8F99]">
						Add a new client to your CRM
					</p>
				</div>
				<Button
					type="button"
					variant="outline"
					className="h-9 rounded-md border border-[#262B34] bg-[#0D1016] px-4 text-xs font-medium text-[#B8C0CF] transition-colors hover:bg-[#1A1D22] hover:text-[#F2F3F5] hover:border-[#333A44]"
				>
					Import
				</Button>
			</div>

			<div className="grid gap-4 lg:grid-cols-[1fr_320px]">
				<Card className="rounded-[10px] border-[#1A1D22] bg-[#0D1016]">
					<CardContent className="p-4 md:p-5">
						<form onSubmit={onSubmit} className="space-y-4">
							<div className="grid gap-3 md:grid-cols-2">
								<Field label="Client Name *" error={nameError}>
									<Input
										value={state.name}
										onChange={(event) =>
											setState((prev) => ({
												...prev,
												name: event.target.value,
											}))
										}
										className={inputClass}
										placeholder="Client Name *"
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
								<Field label="Email *" error={emailError}>
									<Input
										value={state.email}
										onChange={(event) =>
											setState((prev) => ({
												...prev,
												email: event.target.value,
											}))
										}
										className={`${inputClass} ${emailError ? "border-[#B75555]" : ""}`}
										placeholder="Email *"
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
										placeholder="Phone"
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
								<Field label="Tax ID / VAT">
									<Input
										value={state.taxId}
										onChange={(event) =>
											setState((prev) => ({
												...prev,
												taxId: event.target.value,
											}))
										}
										className={inputClass}
										placeholder="Tax ID / VAT"
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
										<SelectContent className="border-[#1A1D22] bg-[#0D1016] text-[#F2F3F5]">
											<SelectItem value="USD">USD</SelectItem>
											<SelectItem value="EUR">EUR</SelectItem>
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
										<SelectContent className="border-[#1A1D22] bg-[#0D1016] text-[#F2F3F5]">
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
									className="resize-none rounded-[10px] border-[#1A1D22] bg-[#0A0D12] text-sm text-[#F2F3F5] placeholder:text-[#7F8794] focus-visible:ring-0 focus-visible:border-[#2F3540]"
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
									className="resize-none rounded-[10px] border-[#1A1D22] bg-[#0A0D12] text-sm text-[#F2F3F5] placeholder:text-[#7F8794] focus-visible:ring-0 focus-visible:border-[#2F3540]"
									placeholder="Internal Notes"
								/>
							</Field>

							<Card className="rounded-[10px] border-[#1A1D22] bg-[#0A0D12]">
								<CardContent className="p-3 md:p-4">
									<h2 className="mb-3 text-sm font-semibold text-[#C8FF1A]">
										Contact Person
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
								</CardContent>
							</Card>

							<div className="inline-flex items-center gap-2 text-sm text-[#AEB6C2]">
								<Switch
									checked={state.favorite}
									onCheckedChange={(checked) =>
										setState((prev) => ({ ...prev, favorite: checked }))
									}
									className="data-[state=checked]:bg-[#C8FF1A] data-[state=unchecked]:bg-[#2A3038]"
								/>
								<span>Save as favorite client</span>
							</div>

							<div className="flex items-center justify-between border-t border-[#1A1D22] pt-4">
								<Button
									type="button"
									variant="outline"
									onClick={() => navigate({ to: "/clients" })}
									className="h-10 rounded-[10px] border-[#2A3038] bg-transparent text-sm font-semibold text-[#DCE1E8] hover:bg-[#141922]"
								>
									Cancel
								</Button>
								<Button
									type="submit"
									disabled={!isValid || submitting}
									className="h-10 rounded-[10px] bg-[#C8FF1A] text-sm font-bold text-[#050607] hover:bg-[#d3ff4f] disabled:bg-[#C8FF1A66] disabled:text-[#1E260D]"
								>
									{submitting ? "Creating..." : "Create Client"}
								</Button>
							</div>
							<p className="text-xs text-[#8A8F99]">* Required fields</p>
						</form>
					</CardContent>
				</Card>

				<Card className="h-fit rounded-[10px] border-[#1A1D22] bg-[#0D1016]">
					<CardContent className="p-4">
						<h2 className="text-sm font-semibold text-[#C8FF1A]">
							Client Preview
						</h2>
						<div className="mt-3 flex items-center gap-3">
							<span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[#141B24] text-xs font-semibold text-[#B8C0CF]">
								{initials || "VC"}
							</span>
							<div>
								<p className="text-sm font-medium text-[#F2F3F5]">
									{state.name || "Client Name"}
								</p>
								<p className="text-xs text-[#8A8F99]">
									{state.company || "Company"}
								</p>
							</div>
						</div>
						<div className="mt-3 rounded-[10px] border border-[#1A1D22] bg-[#0A0D12] p-3 text-xs text-[#B8C0CF]">
							<p>Contact: {state.email || "—"}</p>
							<p>Payment Terms: {state.paymentTerms}</p>
							<p>Currency: {state.currency}</p>
							<p>Favorite: {state.favorite ? "Yes" : "No"}</p>
						</div>
					</CardContent>
				</Card>
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
			<Label className="text-xs text-[#8A8F99]">{label}</Label>
			{children}
			{error ? <p className="text-xs text-[#C77A7A]">{error}</p> : null}
		</div>
	);
}
