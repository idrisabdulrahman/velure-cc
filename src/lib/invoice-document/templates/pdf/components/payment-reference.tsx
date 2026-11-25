import { Text, View } from "@react-pdf/renderer";

type Props = {
	label: string;
	value: string;
};

/**
 * The printed payment reference row (invoice number) shown under the payment
 * instructions, so a payer can quote it in a bank-transfer narration.
 */
export function PaymentReference({ label, value }: Props) {
	return (
		<View style={{ flexDirection: "row", marginTop: 8 }}>
			<Text
				style={{
					fontSize: 9,
					fontWeight: 500,
					marginRight: 2,
				}}
			>
				{label}:
			</Text>
			<Text style={{ fontSize: 9 }}>{value}</Text>
		</View>
	);
}
