import { createStore } from "zustand";

interface StoreState {
	firstName: string;
	lastName: string;
}

export const store = createStore<StoreState>(() => ({
	firstName: "Jane",
	lastName: "Smith",
}));

export const getFullName = () => {
	const state = store.getState();
	return `${state.firstName} ${state.lastName}`;
};
