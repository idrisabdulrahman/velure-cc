export function Status({
	status,
}: {
	status:
		| "draft"
		| "overdue"
		| "paid"
		| "unpaid"
		| "partially-paid"
		| "canceled";
}) {
	const getStatusStyles = () => {
		if (status === "draft" || status === "canceled") {
			return "text-[#817d72] bg-[#1a2117] text-[20px]";
		}

		if (status === "overdue") {
			return "bg-[#262111] text-[#FFD02B]";
		}

		if (status === "paid") {
			return "text-[#00C969] bg-[#17241B]";
		}

		if (status === "partially-paid") {
			return "text-[#8ed5db] bg-[#14292b]";
		}

		return "text-[#F5F5F3] bg-[#292928]";
	};

	return (
		<div
			tw={`flex px-4 py-1 rounded-full max-w-full text-[22px] ${getStatusStyles()}`}
			style={{ fontFamily: "hedvig-sans" }}
		>
			<span style={{ fontFamily: "hedvig-sans" }}>
				{status === "partially-paid"
					? "Partially paid"
					: status.charAt(0).toUpperCase() + status.slice(1)}
			</span>
		</div>
	);
}
