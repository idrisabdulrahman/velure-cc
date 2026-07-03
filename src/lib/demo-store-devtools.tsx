import { EventClient } from "@tanstack/devtools-event-client";
import { useEffect, useState } from "react";

import { getFullName, store } from "./demo-store";

type EventMap = {
	"store-devtools:state": {
		firstName: string;
		lastName: string;
		fullName: string;
	};
};

class StoreDevtoolsEventClient extends EventClient<EventMap> {
	constructor() {
		super({
			pluginId: "store-devtools",
		});
	}
}

const sdec = new StoreDevtoolsEventClient();

store.subscribe(() => {
	const state = store.getState();
	sdec.emit("store-devtools:state", {
		firstName: state.firstName,
		lastName: state.lastName,
		fullName: getFullName(),
	});
});

function DevtoolPanel() {
	const current = store.getState();
	const [state, setState] = useState<EventMap["store-devtools:state"]>(() => ({
		firstName: current.firstName,
		lastName: current.lastName,
		fullName: getFullName(),
	}));

	useEffect(() => {
		return sdec.on("store-devtools:state", (e) => setState(e.payload));
	}, []);

	return (
		<div className="p-4 grid gap-4 grid-cols-[1fr_10fr]">
			<div className="text-sm font-bold text-gray-500 whitespace-nowrap">
				First Name
			</div>
			<div className="text-sm">{state?.firstName}</div>
			<div className="text-sm font-bold text-gray-500 whitespace-nowrap">
				Last Name
			</div>
			<div className="text-sm">{state?.lastName}</div>
			<div className="text-sm font-bold text-gray-500 whitespace-nowrap">
				Full Name
			</div>
			<div className="text-sm">{state?.fullName}</div>
		</div>
	);
}

export default {
	name: "TanStack Store",
	render: <DevtoolPanel />,
};
