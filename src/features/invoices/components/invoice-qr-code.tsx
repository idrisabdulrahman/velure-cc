import { useEffect, useState } from "react";
import { cn } from "#/lib/utils";

type InvoiceQrCodeProps = {
	/** Absolute public URL. The invoice token in it makes every code unique. */
	value: string;
	/** Rendered edge length in CSS pixels. The bitmap is drawn at 2x. */
	size?: number;
	/** Accessible name, e.g. "QR code for invoice FR35NOINC-2026-0109". */
	label: string;
	className?: string;
};

/**
 * A QR code for the invoice's own public link.
 *
 * `qrcode` is loaded on demand inside the effect so the encoder never enters the
 * server/Worker module graph, and a canvas-less environment (jsdom, an older
 * browser) simply renders nothing instead of breaking the success panel.
 *
 * The tile is always light with dark modules regardless of the app theme: a
 * scanner needs that contrast, and the receipt card is dark in dark mode.
 */
export function InvoiceQrCode({
	value,
	size = 84,
	label,
	className,
}: InvoiceQrCodeProps) {
	const [dataUrl, setDataUrl] = useState<string | null>(null);
	const pixelSize = size * 2;

	useEffect(() => {
		let cancelled = false;
		setDataUrl(null);
		if (!value) return;

		void (async () => {
			try {
				const { default: QRCodeUtil } = await import("qrcode");
				const url = await QRCodeUtil.toDataURL(value, {
					errorCorrectionLevel: "M",
					margin: 1,
					width: pixelSize,
					color: { dark: "#14100dff", light: "#ffffffff" },
				});
				if (!cancelled) setDataUrl(url);
			} catch {
				if (!cancelled) setDataUrl(null);
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [value, pixelSize]);

	return (
		<div
			className={cn(
				"inline-flex shrink-0 items-center justify-center border border-rule bg-[oklch(98.2%_0.006_70)]",
				className,
			)}
			style={{ width: size + 12, height: size + 12 }}
		>
			{dataUrl ? (
				<img
					src={dataUrl}
					alt={label}
					width={size}
					height={size}
					className="block"
					style={{ imageRendering: "pixelated" }}
				/>
			) : (
				<span
					aria-hidden="true"
					className="block bg-[oklch(92%_0.012_70)]"
					style={{ width: size, height: size }}
				/>
			)}
		</div>
	);
}
