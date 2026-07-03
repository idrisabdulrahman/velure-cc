import { Link } from "@tanstack/react-router";
import { authClient } from "#/lib/auth-client";

export default function BetterAuthHeader() {
	const { data: session, isPending } = authClient.useSession();

	if (isPending) {
		return (
			<div className="h-8 w-8 animate-pulse border border-[#30352f] bg-[#151817]" />
		);
	}

	if (session?.user) {
		return (
			<div className="flex items-center gap-2">
				{session.user.image ? (
					<img src={session.user.image} alt="" className="h-8 w-8" />
				) : (
					<div className="flex h-8 w-8 items-center justify-center border border-[#c8ff62]/45 bg-[#1a2117]">
						<span className="text-xs font-bold text-[#f2efe7]">
							{session.user.name?.charAt(0).toUpperCase() || "U"}
						</span>
					</div>
				)}
				<button
					type="button"
					onClick={() => {
						void authClient.signOut();
					}}
					className="h-9 flex-1 border border-[#30352f] bg-[#151817] px-4 text-sm font-medium text-[#d8d1c4] transition-colors hover:border-[#3f5130] hover:bg-[#1a2117] hover:text-[#f2efe7]"
				>
					Sign out
				</button>
			</div>
		);
	}

	return (
		<Link
			to="/auth"
			className="inline-flex h-9 items-center border border-[#30352f] bg-[#151817] px-4 text-sm font-medium text-[#d8d1c4] transition-colors hover:border-[#3f5130] hover:bg-[#1a2117] hover:text-[#f2efe7]"
		>
			Sign in
		</Link>
	);
}
