import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createRequestId,
	emitActivation,
	logServerError,
	logServerEvent,
	withRequestObservability,
} from "./observability";

afterEach(() => {
	vi.restoreAllMocks();
});

function parseLastCall(
	spy: ReturnType<typeof vi.spyOn>,
): Record<string, unknown> {
	const raw = spy.mock.calls.at(-1)?.[0];
	expect(typeof raw).toBe("string");
	return JSON.parse(raw as string) as Record<string, unknown>;
}

describe("createRequestId", () => {
	it("returns a non-empty, unique id", () => {
		const a = createRequestId();
		const b = createRequestId();
		expect(a.length).toBeGreaterThan(0);
		expect(a).not.toBe(b);
	});
});

describe("logServerEvent", () => {
	it("writes one JSON line with level and event", () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		logServerEvent("info", "unit.test", { a: 1 });

		const payload = parseLastCall(log);
		expect(payload.level).toBe("info");
		expect(payload.event).toBe("unit.test");
		expect(payload.a).toBe(1);
		expect(typeof payload.ts).toBe("string");
	});

	it("redacts an email nested in the fields", () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		logServerEvent("info", "unit.test", {
			user: { email: "ada@velure.ng" },
		});

		const payload = parseLastCall(log);
		expect(payload.user).toEqual({ email: "[redacted-email]" });
	});

	it("routes warn and error to the matching console method", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		logServerEvent("warn", "w");
		logServerEvent("error", "e");

		expect(parseLastCall(warn).event).toBe("w");
		expect(parseLastCall(error).event).toBe("e");
	});
});

describe("logServerError", () => {
	it("serializes a PostgREST-shaped error with a stable code and the request id", () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		logServerError(
			{ message: "relation does not exist", code: "42P01", hint: "check it" },
			{ requestId: "req-1" },
		);

		const payload = parseLastCall(error);
		expect(payload.level).toBe("error");
		expect(payload.event).toBe("server_error");
		expect(payload.code).toBe("42P01");
		expect(payload.requestId).toBe("req-1");
		expect(String(payload.message)).toContain("relation does not exist");
	});

	it("defaults the code to internal_error and captures a stack for a thrown Error", () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		logServerError(new Error("boom"));

		const payload = parseLastCall(error);
		expect(payload.code).toBe("internal_error");
		expect(payload.message).toBe("boom");
		expect(typeof payload.stack).toBe("string");
	});
});

describe("emitActivation", () => {
	it("writes an activation line with the dotted name", () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		emitActivation("payment.recorded", { invoiceId: "inv_1", amount: 5000 });

		const payload = parseLastCall(log);
		expect(payload.event).toBe("activation");
		expect(payload.activation).toBe("payment.recorded");
		expect(payload.invoiceId).toBe("inv_1");
		expect(payload.amount).toBe(5000);
	});
});

describe("withRequestObservability", () => {
	it("passes a request id into the handler", async () => {
		const handler = withRequestObservability(async (requestId: string) =>
			Response.json({ ok: true, requestId }),
		);

		const response = await handler();
		const body = (await response.json()) as { requestId: string };
		expect(body.requestId.length).toBeGreaterThan(0);
	});

	it("returns a generic 500 and logs one correlated error on failure", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const handler = withRequestObservability(async () => {
			throw new Error("secret internal detail");
		});

		const response = await handler();
		expect(response.status).toBe(500);

		const body = (await response.json()) as Record<string, unknown>;
		// Never leak the internal message, a stack or SQL to the client.
		expect(JSON.stringify(body)).toBe('{"error":"Something went wrong."}');

		expect(error).toHaveBeenCalledTimes(1);
		const payload = parseLastCall(error);
		expect(payload.event).toBe("server_error");
		expect(typeof payload.requestId).toBe("string");
		expect(String(payload.message)).toContain("secret internal detail");
	});
});
