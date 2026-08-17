import { createLazyFileRoute } from "@tanstack/react-router";
import { ClientsIndex } from "#/components/clients/clients-index";

export const Route = createLazyFileRoute("/clients/")({
	component: ClientsIndex,
});