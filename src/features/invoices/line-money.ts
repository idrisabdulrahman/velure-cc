type PricedLine = { quantity: number; price: number };

export function priceToKobo(value: string | number): number {
	const match = String(value)
		.replaceAll(",", "")
		.match(/^(-?)(\d*)(?:\.(\d*))?$/);
	if (!match || (!match[2] && !match[3])) return 0;
	const fraction = match[3] ?? "";
	const minor =
		BigInt(match[2] || "0") * 100n +
		BigInt(fraction.padEnd(2, "0").slice(0, 2) || "0") +
		(fraction.length > 2 && fraction[2] >= "5" ? 1n : 0n);
	const signed = match[1] ? -minor : minor;
	if (
		signed > BigInt(Number.MAX_SAFE_INTEGER) ||
		signed < BigInt(Number.MIN_SAFE_INTEGER)
	) {
		throw new RangeError("Price exceeds safe minor-unit range.");
	}
	return Number(signed);
}

export function lineTotalKobo({ quantity, price }: PricedLine): number {
	if (!Number.isSafeInteger(quantity) || quantity < 0) {
		throw new RangeError("Quantity must be a non-negative whole number.");
	}
	const total = BigInt(quantity) * BigInt(priceToKobo(price));
	if (
		total > BigInt(Number.MAX_SAFE_INTEGER) ||
		total < BigInt(Number.MIN_SAFE_INTEGER)
	) {
		throw new RangeError("Line total exceeds safe minor-unit range.");
	}
	return Number(total);
}

export function subtotalKobo(items: PricedLine[]): number {
	const total = items.reduce(
		(sum, item) => sum + BigInt(lineTotalKobo(item)),
		0n,
	);
	if (
		total > BigInt(Number.MAX_SAFE_INTEGER) ||
		total < BigInt(Number.MIN_SAFE_INTEGER)
	) {
		throw new RangeError("Subtotal exceeds safe minor-unit range.");
	}
	return Number(total);
}
