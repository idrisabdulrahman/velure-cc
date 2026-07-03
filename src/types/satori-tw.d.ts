import "react";

declare module "react" {
	// biome-ignore lint/correctness/noUnusedVariables: React's declaration merge requires the original generic shape.
	interface HTMLAttributes<T> {
		tw?: string;
	}

	// biome-ignore lint/correctness/noUnusedVariables: React's declaration merge requires the original generic shape.
	interface ImgHTMLAttributes<T> {
		tw?: string;
	}
}
