import { Type, type Static } from "typebox";
import type {
	AgentToolResult,
	AgentToolUpdateCallback,
} from "@earendil-works/pi-agent-core";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export const Params = Type.Object({
	n: Type.Number({
		description: "Number of sequential ctx.modelRegistry.complete() calls to make",
		minimum: 1,
		maximum: 100,
		default: 10,
	}),
	prompt: Type.Optional(
		Type.String({
			description: "Prompt text to send each call. Keep short — maxTokens is capped at 16.",
			default: "Say 'ok' in one word.",
		}),
	),
});

export type Params = Static<typeof Params>;

export interface CallRecord {
	i: number;
	durationMs: number;
	stopReason: string;
	ok: boolean;
	error?: string;
}

export interface StressDetails {
	calls: CallRecord[];
	
	lastOk: number;
	totalMs: number;
}

export const sat12StressTest = {
	name: "sat12_stress_test",
	label: "SAT-12 Stress Test",
	description:
		"Probes Pi's tool execution timeout ceiling by making N sequential ctx.modelRegistry.complete() calls. Reports per-call duration and stop reason. Use the results to determine the safe maximum cumulative LLM call time inside a single tool execution.",
	promptSnippet:
		"sat12_stress_test(n) — make N sequential LLM calls, report timing, probe timeout ceiling",
	parameters: Params,
	executionMode: "sequential" as const,

	async execute(
		_toolCallId: string,
		params: Params,
		_signal: AbortSignal | undefined,
		onUpdate: AgentToolUpdateCallback<StressDetails> | undefined,
		ctx: ExtensionContext,
	): Promise<AgentToolResult<StressDetails>> {
		
		
		const registry = ctx.modelRegistry as any;
		const completeFn: ((model: any, context: any, options?: any) => Promise<any>) | undefined =
			typeof registry.complete === "function"
				? (m, c, o) => registry.complete(m, c, o)
				: typeof registry.runtime?.complete === "function"
					? (m, c, o) => registry.runtime.complete(m, c, o)
					: undefined;

		if (!completeFn) {
			return {
				content: [
					{
						type: "text",
						text: "Error: no complete() method found on modelRegistry or modelRegistry.runtime. Pi version unsupported.",
					},
				],
				details: { calls: [], lastOk: 0, totalMs: 0 },
			};
		}

		const model = ctx.model;

		if (!model) {
			return {
				content: [
					{
						type: "text",
						text: "Error: ctx.model is undefined. Select a model before running the stress test.",
					},
				],
				details: { calls: [], lastOk: 0, totalMs: 0 },
			};
		}

		const n = params.n;
		const prompt = params.prompt ?? "Say 'ok' in one word.";
		const calls: CallRecord[] = [];
		const overallStart = Date.now();

		for (let i = 1; i <= n; i++) {
			const t0 = Date.now();
			let stopReason = "unknown";
			let ok = false;
			let error: string | undefined;

			try {
				const result = await completeFn(
					model,
					{ messages: [{ role: "user", content: prompt, timestamp: t0 }] },
					{ maxTokens: 16 },
				);
				stopReason = result.stopReason;
				ok = result.stopReason === "stop" || result.stopReason === "length";
				if (!ok && result.errorMessage) {
					error = result.errorMessage;
				}
			} catch (err) {
				stopReason = "threw";
				error = err instanceof Error ? err.message : String(err);
			}

			const durationMs = Date.now() - t0;
			calls.push({ i, durationMs, stopReason, ok, error });

			if (onUpdate) {
				const totalMs = Date.now() - overallStart;
				const okSoFar = calls.filter((c) => c.ok);
				const lastOk = okSoFar.length > 0 ? Math.max(...okSoFar.map((c) => c.i)) : 0;
				onUpdate({
					content: [
						{
							type: "text",
							text: `call ${i}/${n}: ${durationMs}ms — ${stopReason}`,
						},
					],
					details: { calls: [...calls], lastOk, totalMs },
				});
			}
		}

		const totalMs = Date.now() - overallStart;
		const okCalls = calls.filter((c) => c.ok);
		const lastOk = okCalls.length > 0 ? Math.max(...okCalls.map((c) => c.i)) : 0;
		const avgMs =
			okCalls.length > 0
				? Math.round(okCalls.reduce((s, c) => s + c.durationMs, 0) / okCalls.length)
				: 0;

		const rows = calls.map((c) => {
			const status = c.ok ? "ok" : `FAIL(${c.stopReason})`;
			const note = c.error ? ` — ${c.error.slice(0, 100)}` : "";
			return `| ${c.i} | ${c.durationMs} | ${status}${note} |`;
		});

		let interpretation: string;
		if (lastOk === n) {
			interpretation = `All ${n} calls succeeded. Total: ${totalMs}ms. No timeout ceiling detected at this depth. Run again with higher n to probe further.`;
		} else if (lastOk === 0) {
			interpretation = `All calls failed immediately. Check model configuration or endpoint availability.`;
		} else {
			const cumulativeToLastOk = calls.slice(0, lastOk).reduce((s, c) => s + c.durationMs, 0);
			const failRecord = calls[lastOk]; 
			const failReason = failRecord ? failRecord.stopReason : "not reached";
			interpretation = [
				`Last successful call: #${lastOk} of ${n}.`,
				`Call #${lastOk + 1} failed with: ${failReason}${failRecord?.error ? ` (${failRecord.error.slice(0, 100)})` : ""}.`,
				`Cumulative time through last ok call: ${cumulativeToLastOk}ms.`,
				`This is the empirical ceiling for sequential LLM calls in a single tool execution.`,
			].join(" ");
		}

		const report = [
			`## sat12_stress_test — ${n} calls`,
			"",
			`model: ${model.provider}/${model.id}`,
			`total wall time: ${totalMs}ms`,
			`successful: ${okCalls.length}/${n}  avg (ok calls): ${avgMs}ms`,
			"",
			"| # | ms | result |",
			"|---|---|---|",
			...rows,
			"",
			"### Interpretation",
			"",
			interpretation,
		].join("\n");

		return {
			content: [{ type: "text", text: report }],
			details: { calls, lastOk, totalMs },
		};
	},
};
