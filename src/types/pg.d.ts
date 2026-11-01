// `pg@8.23.0` ships no type declarations and `@types/pg` is not installed.
// This is the minimal structural surface Velure actually uses, so the project
// typechecks without pulling in a large third-party declaration file.
declare module "pg" {
	export type QueryResult = {
		rows?: unknown[];
		rowCount?: number | null;
		command?: string;
	};

	export class Client {
		constructor(config?: Record<string, unknown>);
		connect(): Promise<void>;
		query(text: string, values?: unknown[]): Promise<QueryResult>;
		end(): Promise<void>;
	}

	export class Pool {
		constructor(config?: Record<string, unknown>);
	}

	const pg: { Pool: typeof Pool; Client: typeof Client };
	export default pg;
}
