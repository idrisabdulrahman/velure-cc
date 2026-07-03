type Props = {
	logo: string;
	customerName: string;
	appearance?: "print" | "app" | "public";
};

export function Logo({ logo, customerName, appearance = "print" }: Props) {
	const isPublicAppearance = appearance === "public";

	return (
		<div className={isPublicAppearance ? "max-w-[148px]" : "max-w-[300px]"}>
			<img
				src={logo}
				alt={customerName}
				style={{
					height: isPublicAppearance ? 42 : 80,
					objectFit: "contain",
				}}
			/>
		</div>
	);
}
