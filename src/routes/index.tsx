import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
	// Route-level meta only: the charset/viewport/title fallback and the
	// favicon/manifest links stay in __root.tsx. Title + description mirror
	// design/landing.html so the public page is indexable with its own copy.
	head: () => ({
		meta: [
			{ title: "Velure — Send the bill. Track the trail." },
			{
				name: "description",
				content:
					"Invoices, clients, VAT and WHT fields, reminders, PDFs and exports in one workspace for Nigerian businesses.",
			},
		],
	}),
});
