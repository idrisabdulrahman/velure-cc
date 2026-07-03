export function toggleInvoiceSelection<T extends string>(
	current: ReadonlySet<T>,
	id: T,
	checked: boolean,
) {
	const next = new Set(current);
	if (checked) {
		next.add(id);
	} else {
		next.delete(id);
	}
	return next;
}

export function setInvoiceSelectionForIds<T extends string>(
	current: ReadonlySet<T>,
	ids: readonly T[],
	checked: boolean,
) {
	const next = new Set(current);
	for (const id of ids) {
		if (checked) {
			next.add(id);
		} else {
			next.delete(id);
		}
	}
	return next;
}

export function keepVisibleInvoiceSelection<T extends string>(
	current: Set<T>,
	visibleIds: ReadonlySet<T>,
) {
	const next = new Set(Array.from(current).filter((id) => visibleIds.has(id)));
	return next.size === current.size ? current : next;
}
