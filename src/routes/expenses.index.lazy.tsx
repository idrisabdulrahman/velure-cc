import { createLazyFileRoute } from "@tanstack/react-router";
import { ExpensesIndex } from "#/components/expenses/expenses-index";

export const Route = createLazyFileRoute("/expenses/")({
	component: ExpensesIndex,
});
