

import { Type, type TSchema } from "typebox";
import { Value } from "typebox/value";
import type { AssistantMessage, Message, Model, Usage } from "@earendil-works/pi-ai";
import { StringEnum as piStringEnum } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

// Export StringEnum again from @earendil-works/pi-ai.
export const StringEnum = piStringEnum;


export function extractText(msg: AssistantMessage): string {
	return msg.content
		.filter((c): c is Extract<(typeof msg.content)[number], { type: "text" }> => c.type === "text")
		.map((c) => c.text)
		.join("");
}


export function repairJsonString(raw: string): string {
	let str = raw.trim();

	
	str = str.replace(/,\s*([}\]])/g, "$1");

	
	const stack: string[] = [];
	let inString = false;
	let escaped = false;

	for (let i = 0; i < str.length; i++) {
		const ch = str[i];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (ch === "\\" && inString) {
			escaped = true;
			continue;
		}
		if (ch === '"') {
			inString = !inString;
			continue;
		}
		if (inString) continue;

		if (ch === "{" || ch === "[") {
			stack.push(ch === "{" ? "}" : "]");
		} else if (ch === "}" || ch === "]") {
			if (stack.length > 0 && stack[stack.length - 1] === ch) {
				stack.pop();
			}
		}
	}

	if (inString) {
		str += '"';
	}

	str = str.replace(/,\s*$/, "");

	while (stack.length > 0) {
		str += stack.pop();
	}

	return str.replace(/,\s*([}\]])/g, "$1");
}


export function extractJson(text: string): string | null {
	if (!text || typeof text !== "string") return null;

	
	const jsonFence = text.match(/```json\s*\n?([\s\S]*?)\n?\s*```/i);
	if (jsonFence) {
		const candidate = jsonFence[1].trim();
		if (candidate) return candidate;
	}

	
	const anyFence = text.match(/```\w*\s*\n?([\s\S]*?)\n?\s*```/);
	if (anyFence) {
		const candidate = anyFence[1].trim();
		if (candidate.startsWith("{") || candidate.startsWith("[")) return candidate;
	}

	
	for (const [open, close] of [
		["{", "}"],
		["[", "]"],
	] as const) {
		const start = text.indexOf(open);
		if (start === -1) continue;

		let depth = 0;
		let inString = false;
		let escaped = false;

		for (let i = start; i < text.length; i++) {
			const ch = text[i];
			if (escaped) {
				escaped = false;
				continue;
			}
			if (ch === "\\" && inString) {
				escaped = true;
				continue;
			}
			if (ch === '"') {
				inString = !inString;
				continue;
			}
			if (inString) continue;
			if (ch === open) depth++;
			else if (ch === close) {
				depth--;
				if (depth === 0) return text.slice(start, i + 1);
			}
		}

		
		const unclosed = text.slice(start);
		const repaired = repairJsonString(unclosed);
		try {
			JSON.parse(repaired);
			return repaired;
		} catch {
			
		}
	}

	
	const firstBrace = text.indexOf("{");
	const lastBrace = text.lastIndexOf("}");
	if (firstBrace !== -1 && lastBrace > firstBrace) {
		return text.slice(firstBrace, lastBrace + 1);
	}

	const firstBracket = text.indexOf("[");
	const lastBracket = text.lastIndexOf("]");
	if (firstBracket !== -1 && lastBracket > firstBracket) {
		return text.slice(firstBracket, lastBracket + 1);
	}

	return null;
}


export function tryParseAndValidate<T>(
	text: string,
	schema: TSchema,
): { ok: true; data: T } | { ok: false; error: string } {
	const jsonText = extractJson(text);
	if (!jsonText) {
		return { ok: false, error: "Response contained no JSON object or array." };
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(jsonText);
	} catch (err) {
		const repaired = repairJsonString(jsonText);
		try {
			parsed = JSON.parse(repaired);
		} catch {
			return { ok: false, error: `JSON parse error: ${err instanceof Error ? err.message : String(err)}` };
		}
	}

	if (Value.Check(schema, parsed)) {
		return { ok: true, data: parsed as T };
	}

	
	try {
		const clone = JSON.parse(JSON.stringify(parsed));
		Value.Default(schema, clone);
		if (Value.Check(schema, clone)) {
			return { ok: true, data: clone as T };
		}
	} catch {
		
	}

	// Report the field path with each message. TypeBox names the field
	// `instancePath`. An older name gave `undefined` here, which hid the field
	// from the model during a retry.
	const errors = [...Value.Errors(schema, parsed)];
	const msg = errors
		.slice(0, 3)
		.map((e) => `${e.instancePath || "(root)"}: ${e.message}`)
		.join("; ");
	return { ok: false, error: `Schema validation failed: ${msg}` };
}


export function prepareStrictSchema(schema: TSchema): unknown {
	const clone = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
	prepareNode(clone);
	return clone;
}

function prepareNode(node: Record<string, unknown>): void {
	delete node.title;
	delete node.default;
	
	delete node.$schema;

	if (node.type === "object" && node.properties && typeof node.properties === "object") {
		node.additionalProperties = false;
		for (const v of Object.values(node.properties as Record<string, unknown>)) {
			if (v && typeof v === "object") prepareNode(v as Record<string, unknown>);
		}
	}

	if (node.type === "array" && node.items) {
		if (typeof node.items === "object") prepareNode(node.items as Record<string, unknown>);
	}

	for (const key of ["anyOf", "oneOf", "allOf"] as const) {
		if (Array.isArray(node[key])) {
			for (const v of node[key] as unknown[]) {
				if (v && typeof v === "object") prepareNode(v as Record<string, unknown>);
			}
		}
	}
}





export class TechniqueValidationError extends Error {
	readonly validationError: string;
	readonly schema: unknown;
	/** Number of model calls made before the failure. */
	readonly attempts: number;

	constructor(validationError: string, schema: unknown, attempts = 0) {
		super(`Technique output failed validation after retry: ${validationError}`);
		this.name = "TechniqueValidationError";
		this.validationError = validationError;
		this.schema = schema;
		this.attempts = attempts;
	}
}

export function isAbortError(err: unknown): boolean {
	if (!err) return false;
	if (err instanceof DOMException && err.name === "AbortError") return true;
	if (err instanceof Error && (err.name === "AbortError" || err.message.includes("aborted") || err.message.includes("Analysis aborted"))) return true;
	return false;
}

export function checkAborted(signal?: AbortSignal, ctx?: ExtensionContext): void {
	if (signal?.aborted || ctx?.signal?.aborted) {
		throw new DOMException("Analysis aborted", "AbortError");
	}
}





function zeroUsage(): Usage {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

export function mergeUsage(a: Usage, b: Usage): Usage {
	return {
		input: a.input + b.input,
		output: a.output + b.output,
		cacheRead: a.cacheRead + b.cacheRead,
		cacheWrite: a.cacheWrite + b.cacheWrite,
		totalTokens: a.totalTokens + b.totalTokens,
		cost: {
			input: a.cost.input + b.cost.input,
			output: a.cost.output + b.cost.output,
			cacheRead: a.cost.cacheRead + b.cost.cacheRead,
			cacheWrite: a.cost.cacheWrite + b.cost.cacheWrite,
			total: a.cost.total + b.cost.total,
		},
	};
}

export interface ModelUsageStats {
	modelId: string;
	modelName?: string;
	role?: "primary" | "challenger" | "secondary";
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	durationMs: number;
	calls: number;
}

export class UsageAccumulator {
	total: Usage = zeroUsage();
	byModel: Record<string, ModelUsageStats> = {};
	byPhase: Record<string, Usage> = {};

	add(
		u: Usage | undefined,
		modelId?: string,
		modelName?: string,
		role?: "primary" | "challenger" | "secondary",
		phase?: string,
		durationMs?: number,
	): void {
		if (!u) return;
		this.total = mergeUsage(this.total, u);

		if (modelId) {
			if (!this.byModel[modelId]) {
				this.byModel[modelId] = {
					modelId,
					modelName: modelName || modelId,
					role: role || "primary",
					inputTokens: 0,
					outputTokens: 0,
					totalTokens: 0,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					durationMs: 0,
					calls: 0,
				};
			}
			const m = this.byModel[modelId];
			m.inputTokens += u.input || 0;
			m.outputTokens += u.output || 0;
			m.totalTokens += u.totalTokens || ((u.input || 0) + (u.output || 0));
			m.cacheReadTokens += u.cacheRead || 0;
			m.cacheWriteTokens += u.cacheWrite || 0;
			m.durationMs += durationMs || 0;
			m.calls += 1;
		}

		if (phase) {
			if (!this.byPhase[phase]) {
				this.byPhase[phase] = zeroUsage();
			}
			this.byPhase[phase] = mergeUsage(this.byPhase[phase], u);
		}
	}
}





export interface StructuredCallOptions<T> {
	model: Model<any>;
	systemPrompt: string;
	messages: Message[];
	schema: TSchema;
	temperature: number;
	signal?: AbortSignal;
	
	semanticCheck?: (data: T) => string | null;
}

export async function completeStructured<T>(
	ctx: ExtensionContext,
	opts: StructuredCallOptions<T>,
	maxAttempts = 4,
): Promise<{
	data: T;
	usage: Usage;
	durationMs: number;
	attempts: number;
	/** Validation error from each failed attempt. Empty when attempt 1 passed. */
	retryErrors: string[];
}> {
	const preparedSchema = prepareStrictSchema(opts.schema);

	const fullSystemPrompt =
		opts.systemPrompt +
		"\n\nRespond with JSON matching this schema exactly:\n" +
		JSON.stringify(preparedSchema, null, 2);

	const check = (text: string): { ok: true; data: T } | { ok: false; error: string } => {
		const parsed = tryParseAndValidate<T>(text, opts.schema);
		if (!parsed.ok) return parsed;
		const semanticError = opts.semanticCheck?.(parsed.data) ?? null;
		return semanticError ? { ok: false, error: semanticError } : { ok: true, data: parsed.data };
	};

	let combinedUsage = zeroUsage();
	let totalDurationMs = 0;
	let currentMessages: Message[] = [...opts.messages];
	let lastError = "";
	let lastText = "";
	/** Validation error from each failed attempt. Empty when attempt 1 passed. */
	const retryErrors: string[] = [];

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		checkAborted(opts.signal, ctx);
		const effectiveSignal = opts.signal || ctx.signal;
		const startMs = Date.now();

		
		const effectiveTemp =
			attempt === 1
				? opts.temperature
				: attempt === maxAttempts
					? 0.0
					: Math.max(0, opts.temperature - 0.2 * (attempt - 1));

		const response = await ctx.modelRegistry.complete(
			opts.model,
			{ systemPrompt: fullSystemPrompt, messages: currentMessages },
			{ signal: effectiveSignal, temperature: effectiveTemp },
		);

		const durationMs = Date.now() - startMs;
		totalDurationMs += durationMs;
		combinedUsage = mergeUsage(combinedUsage, response.usage);

		lastText = extractText(response);
		const parsed = check(lastText);
		if (parsed.ok) {
			return {
				data: parsed.data,
				usage: combinedUsage,
				durationMs: totalDurationMs,
				attempts: attempt,
				retryErrors,
			};
		}

		lastError = parsed.error;
		retryErrors.push(parsed.error);

		if (attempt < maxAttempts) {
			let errorFeedback = `Your previous output failed validation.\n\nError: ${lastError}\n\n`;
			if (attempt >= 2) {
				errorFeedback +=
					"CRITICAL FORMATTING REQUIREMENT:\n" +
					"- Your response MUST be valid JSON only matching the schema.\n" +
					"- Do NOT output markdown code fences, preambles, or conversational introductions.\n" +
					"- Start immediately with '{' on line 1 and end with '}'.\n\n";
			}
			errorFeedback += `Your previous output was:\n\`\`\`\n${lastText.slice(0, 1000)}\n\`\`\`\n\nPlease output ONLY the corrected JSON object.`;

			currentMessages = [
				...opts.messages,
				{
					role: "user" as const,
					content: errorFeedback,
					timestamp: Date.now(),
				},
			];
		}
	}

	throw new TechniqueValidationError(lastError, preparedSchema, maxAttempts);
}





export function resolveModel(
	ctx: ExtensionContext,
	modelId?: string,
): { model: Model<any>; error?: undefined } | { model?: undefined; error: string } {
	if (!modelId) {
		if (!ctx.model) {
			return { error: "No active model selected in Pi. Please select a model." };
		}
		return { model: ctx.model };
	}

	const normalized = modelId.toLowerCase().trim();

	
	if (ctx.scopedModels && ctx.scopedModels.length > 0) {
		const foundScoped = ctx.scopedModels.find(
			(m) =>
				m.model.id.toLowerCase() === normalized ||
				m.model.name?.toLowerCase() === normalized ||
				`${m.model.provider}/${m.model.id}`.toLowerCase() === normalized,
		);
		if (foundScoped) return { model: foundScoped.model };
	}

	
	const availableModels = ctx.modelRegistry ? ctx.modelRegistry.getAvailable() : [];
	const foundAvailable = availableModels.find(
		(m) =>
			m.id.toLowerCase() === normalized ||
			m.name?.toLowerCase() === normalized ||
			`${m.provider}/${m.id}`.toLowerCase() === normalized,
	);
	if (foundAvailable) return { model: foundAvailable };

	
	if (normalized.includes("/") && ctx.modelRegistry) {
		const [provider, ...rest] = normalized.split("/");
		const id = rest.join("/");
		const foundDirect = ctx.modelRegistry.find(provider, id);
		if (foundDirect) {
			if (!ctx.modelRegistry.hasConfiguredAuth(foundDirect)) {
				return {
					error: `Model "${modelId}" exists in provider "${provider}", but no API key is configured. Run "pi provider add ${provider}" to configure credentials.`,
				};
			}
			return { model: foundDirect };
		}
	}

	
	const availableList =
		availableModels.length > 0
			? availableModels.map((m) => `${m.provider}/${m.id}`).join(", ")
			: "none";

	return {
		error: `Requested model "${modelId}" is not configured in Pi. Available configured models: [${availableList}]. Run "pi provider add" to configure credentials.`,
	};
}

export interface AdversarialModelResolution {
	primaryModel: Model<any>;
	challengerModel?: Model<any>;
	investigatorModel?: Model<any>;
	notifications: string[];
	error?: string;
}

export interface ResolveAdversarialModelsParams {
	primary_model?: string;
	challenger_model?: string;
	investigator_model?: string;
	is_explicit_primary?: boolean;
	is_explicit_challenger?: boolean;
	is_explicit_investigator?: boolean;
	adversarial_enabled?: boolean;
	adversarial_mode?: "dual" | "trident";
}

export function resolveAdversarialModels(
	ctx: ExtensionContext,
	params: ResolveAdversarialModelsParams,
): AdversarialModelResolution {
	const notifications: string[] = [];

	
	let primaryModel: Model<any>;
	const primaryRes = resolveModel(ctx, params.primary_model);
	if (!primaryRes.model) {
		if (params.is_explicit_primary || !ctx.model) {
			return { primaryModel: null as any, notifications, error: primaryRes.error };
		}
		notifications.push(
			`Saved primary_model '${params.primary_model}' is no longer available in Pi — falling back to active model (${ctx.model.id}).`,
		);
		primaryModel = ctx.model;
	} else {
		primaryModel = primaryRes.model;
	}

	
	let challengerModel: Model<any> | undefined;
	if (params.challenger_model) {
		const challRes = resolveModel(ctx, params.challenger_model);
		if (challRes.error) {
			if (params.is_explicit_challenger) {
				return { primaryModel, notifications, error: `Challenger model error: ${challRes.error}` };
			}
			notifications.push(
				`Saved challenger_model '${params.challenger_model}' is no longer available in Pi — falling back.`,
			);
		} else {
			challengerModel = challRes.model;
		}
	}

	
	let investigatorModel: Model<any> | undefined;
	if (params.investigator_model) {
		const invRes = resolveModel(ctx, params.investigator_model);
		if (invRes.error) {
			if (params.is_explicit_investigator) {
				return { primaryModel, notifications, error: `Investigator model error: ${invRes.error}` };
			}
			notifications.push(
				`Saved investigator_model '${params.investigator_model}' is no longer available in Pi — falling back.`,
			);
		} else {
			investigatorModel = invRes.model;
		}
	}

	const adversarialEnabled = params.adversarial_enabled ?? true;
	const adversarialMode = params.adversarial_mode ?? "dual";

	
	if (!adversarialEnabled) {
		if (params.challenger_model || params.investigator_model) {
			notifications.push(
				"Challenger/investigator model set but adversarial mode is disabled — ignoring adversarial models.",
			);
		}
		return { primaryModel, notifications };
	}

	
	if (adversarialMode === "trident") {
		if (!challengerModel) {
			challengerModel = primaryModel;
			notifications.push(
				`Challenger model unset for trident mode — falling back to primary model (${primaryModel.id}).`,
			);
		}
		if (!investigatorModel) {
			if (params.challenger_model && challengerModel) {
				investigatorModel = challengerModel;
				notifications.push(
					`Investigator model unset for trident mode — falling back to challenger model (${challengerModel.id}).`,
				);
			} else {
				investigatorModel = primaryModel;
				notifications.push(
					`Investigator model unset for trident mode — falling back to primary model (${primaryModel.id}).`,
				);
			}
		}
		return { primaryModel, challengerModel, investigatorModel, notifications };
	}

	
	if (!challengerModel) {
		challengerModel = primaryModel;
		notifications.push(
			`Challenger model unset for dual mode — falling back to primary model (${primaryModel.id}).`,
		);
	}

	return { primaryModel, challengerModel, notifications };
}
