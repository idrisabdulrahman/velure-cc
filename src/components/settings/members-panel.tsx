import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Panel } from "#/components/redesign/panel";
import { StatusPill } from "#/components/redesign/status-pill";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { PanelLoader } from "#/components/ui/panel-loader";
import { toast } from "#/components/ui/use-toast";

/**
 * WP-E — the Members panel on Settings › General.
 *
 * Lists the workspace's members with role and email and, for the owner only,
 * invites an accountant as a read-only `viewer`. The list and the invite go
 * through the session-authenticated server route; the invite itself runs
 * server-side because RLS does not let a user add another user's membership.
 * The owner gate here is cosmetic — the route re-checks the role — and the
 * viewer's read-only access is enforced by RLS, not by this component.
 */

export type WorkspaceMemberView = {
	userId: string;
	email: string | null;
	role: "owner" | "member" | "viewer";
	invitedBy: string | null;
	createdAt: string;
};

type MembersResponse = {
	ok: boolean;
	role?: WorkspaceMemberView["role"];
	members?: WorkspaceMemberView[];
	error?: string;
};

const ROLE_LABEL: Record<WorkspaceMemberView["role"], string> = {
	owner: "Owner",
	member: "Member",
	viewer: "Viewer (read-only)",
};

async function loadMembers(): Promise<WorkspaceMemberView[]> {
	const response = await fetch("/api/workspace/members", {
		headers: { accept: "application/json" },
	});
	const body = (await response
		.json()
		.catch(() => null)) as MembersResponse | null;
	if (!response.ok || !body?.ok || !body.members) {
		throw new Error(body?.error ?? "Could not load members.");
	}
	return body.members;
}

async function inviteMember(email: string): Promise<void> {
	const response = await fetch("/api/workspace/members", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ email }),
	});
	const body = (await response
		.json()
		.catch(() => null)) as MembersResponse | null;
	if (!response.ok || !body?.ok) {
		throw new Error(body?.error ?? "Could not send the invite.");
	}
}

export function MembersPanel({ canInvite }: { canInvite: boolean }) {
	const queryClient = useQueryClient();
	const [email, setEmail] = useState("");
	const membersQuery = useQuery({
		queryKey: ["workspace-members"],
		queryFn: loadMembers,
	});
	const invite = useMutation({
		mutationFn: inviteMember,
		onSuccess: () => {
			setEmail("");
			toast({
				title: "Viewer invited",
				description:
					"They can read invoices, clients and products, but cannot change anything.",
				variant: "success",
			});
			void queryClient.invalidateQueries({ queryKey: ["workspace-members"] });
		},
		onError: (error) => {
			toast({
				title: "Could not invite",
				description: error instanceof Error ? error.message : "Unknown error",
				variant: "error",
			});
		},
	});

	const members = membersQuery.data ?? [];

	return (
		<Panel
			title="Members"
			sub="Who can read this workspace, and the owner who can change it."
		>
			{membersQuery.isPending ? (
				<PanelLoader label="Loading members" />
			) : membersQuery.isError ? (
				<div className="flex flex-col items-start gap-3">
					<p role="alert" className="text-sm text-danger">
						Could not load members. Check your connection and try again.
					</p>
					<Button
						type="button"
						variant="outline"
						onClick={() => {
							void membersQuery.refetch();
						}}
						className="h-9 rounded-md border-rule bg-transparent px-3 text-sm text-ink-2 hover:bg-paper-3"
					>
						Retry
					</Button>
				</div>
			) : (
				<ul aria-label="Workspace members" className="flex flex-col">
					{members.map((member) => (
						<li
							key={member.userId}
							className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-rule/60 py-3 last:border-b-0"
						>
							<div className="min-w-0">
								<p className="truncate text-sm text-ink">
									{member.email ?? "Account not linked"}
								</p>
								<p className="mt-0.5 text-xs text-ink-3">
									{member.role === "viewer" && member.invitedBy
										? "Invited by the workspace owner"
										: "Workspace access"}
								</p>
							</div>
							<StatusPill tone={member.role === "viewer" ? "mute" : "info"}>
								{ROLE_LABEL[member.role]}
							</StatusPill>
						</li>
					))}
				</ul>
			)}

			{canInvite ? (
				<form
					className="mt-4 flex flex-col gap-3 border-t border-rule/60 pt-4 sm:flex-row sm:items-end"
					onSubmit={(event) => {
						event.preventDefault();
						const value = email.trim();
						if (!value) return;
						invite.mutate(value);
					}}
				>
					<div className="min-w-0 flex-1">
						<label
							htmlFor="member-invite-email"
							className="mb-1.5 block text-xs font-medium text-ink-2"
						>
							Invite an accountant (read-only viewer)
						</label>
						<Input
							id="member-invite-email"
							type="email"
							required
							autoComplete="email"
							value={email}
							onChange={(event) => setEmail(event.target.value)}
							placeholder="accountant@example.com"
							className="rounded-md border-rule bg-paper text-ink focus-visible:border-brand"
						/>
						<p className="mt-1.5 text-[11.5px] text-ink-3">
							They must already have an Invoicly account.
						</p>
					</div>
					<Button
						type="submit"
						disabled={invite.isPending || !email.trim()}
						className="h-10 rounded-md bg-brand px-4 text-sm font-medium text-brand-ink hover:bg-brand-hi"
					>
						{invite.isPending ? "Inviting…" : "Send invite"}
					</Button>
				</form>
			) : (
				<p className="mt-4 border-t border-rule/60 pt-4 text-xs text-ink-3">
					Only the workspace owner can invite members.
				</p>
			)}
		</Panel>
	);
}
