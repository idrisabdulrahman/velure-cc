import { createFileRoute } from "@tanstack/react-router";
import { resolveActiveWorkspaceId } from "#/server/data/workspaces";
import { getInvoiceUserContext } from "#/server/invoice-repository";

const MARKER = /^[a-zA-Z0-9_-]{1,80}$/;

function allowedRuntime() {
	return (
		process.env.NODE_ENV !== "production" &&
		process.env.VELURE_ENABLE_TEST_FIXTURES === "1"
	);
}

function markerFrom(request: Request) {
	const value = new URL(request.url).searchParams.get("marker") ?? "";
	if (!MARKER.test(value)) throw new Error("Invalid fixture marker.");
	return value;
}

export const Route = createFileRoute("/api/test/fixtures")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				if (!allowedRuntime())
					return Response.json({ error: "Not found." }, { status: 404 });
				try {
					const marker = markerFrom(request);
					const context = await getInvoiceUserContext(request);
					if (!context)
						return Response.json(
							{ error: "Authentication required." },
							{ status: 401 },
						);
					const workspaceId = await resolveActiveWorkspaceId(
						context.client,
						context.userId,
					);
					if (!workspaceId)
						return Response.json(
							{ error: "No active workspace." },
							{ status: 409 },
						);
					const email = `fixture.${marker}@example.test`;
					const sku = `FIXTURE-${marker}`;
					const [
						{ data: existingClient, error: clientReadError },
						{ data: existingProduct, error: productReadError },
					] = await Promise.all([
						context.client
							.from("clients")
							.select("id")
							.eq("workspace_id", workspaceId)
							.eq("email", email)
							.maybeSingle(),
						context.client
							.from("products")
							.select("id")
							.eq("workspace_id", workspaceId)
							.eq("sku", sku)
							.is("deleted_at", null)
							.maybeSingle(),
					]);
					if (clientReadError) throw clientReadError;
					if (productReadError) throw productReadError;
					let clientId = existingClient?.id;
					if (!clientId) {
						const { data, error } = await context.client
							.from("clients")
							.insert({
								workspace_id: workspaceId,
								owner_id: context.userId,
								name: `Fixture Client ${marker}`,
								email,
								currency: "NGN",
								payment_terms: "14 days",
								contact: {},
								favorite: false,
								status: "active",
							})
							.select("id")
							.single();
						if (error) throw error;
						clientId = data.id;
					}
					let productId = existingProduct?.id;
					if (!productId) {
						const { data, error } = await context.client
							.from("products")
							.insert({
								workspace_id: workspaceId,
								type: "service",
								name: `Fixture Service ${marker}`,
								sku,
								unit_name: "service",
								default_unit_price: 25000,
								is_active: true,
							})
							.select("id")
							.single();
						if (error) throw error;
						productId = data.id;
					}
					return Response.json({ marker, workspaceId, clientId, productId });
				} catch (error) {
					return Response.json(
						{
							error:
								error instanceof Error
									? error.message
									: "Fixture creation failed.",
						},
						{ status: 400 },
					);
				}
			},
			DELETE: async ({ request }) => {
				if (!allowedRuntime())
					return Response.json({ error: "Not found." }, { status: 404 });
				try {
					const marker = markerFrom(request);
					const context = await getInvoiceUserContext(request);
					if (!context)
						return Response.json(
							{ error: "Authentication required." },
							{ status: 401 },
						);
					const workspaceId = await resolveActiveWorkspaceId(
						context.client,
						context.userId,
					);
					if (!workspaceId)
						return Response.json(
							{ error: "No active workspace." },
							{ status: 409 },
						);
					const { data: fixtureClient, error: fixtureClientError } =
						await context.client
							.from("clients")
							.select("id")
							.eq("workspace_id", workspaceId)
							.eq("owner_id", context.userId)
							.eq("email", `fixture.${marker}@example.test`)
							.maybeSingle();
					if (fixtureClientError) throw fixtureClientError;
					if (fixtureClient) {
						const { error: invoiceError } = await context.client
							.from("invoices")
							.delete()
							.eq("workspace_id", workspaceId)
							.eq("customer_id", fixtureClient.id);
						if (invoiceError) throw invoiceError;
					}
					const [{ error: clientError }, { error: productError }] =
						await Promise.all([
							context.client
								.from("clients")
								.delete()
								.eq("workspace_id", workspaceId)
								.eq("owner_id", context.userId)
								.eq("email", `fixture.${marker}@example.test`),
							context.client
								.from("products")
								.delete()
								.eq("workspace_id", workspaceId)
								.eq("sku", `FIXTURE-${marker}`),
						]);
					if (clientError) throw clientError;
					if (productError) throw productError;
					return Response.json({ ok: true, marker });
				} catch (error) {
					return Response.json(
						{
							error:
								error instanceof Error
									? error.message
									: "Fixture cleanup failed.",
						},
						{ status: 400 },
					);
				}
			},
		},
	},
});
