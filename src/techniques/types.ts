

import type { TSchema } from "typebox";





export interface TechniqueDefinition {
	
	id: string;
	
	name: string;
	category: "diagnostic" | "contrarian" | "imaginative";
	
	layer: number;
	
	dependencies: string[];
	
	temperature: number;
	
	systemPrompt: string;
	
	outputSchema: TSchema;
	
	semanticCheck?: (data: unknown, context?: SemanticCheckContext) => string | null;
}

export interface SemanticCheckContext {
	/** Source-rating overrides from the user. Map a path or id to an Admiralty code. */
	userOverrides?: Record<string, string>;
	/** True when the technique got evidence or context text that is not empty. */
	hasEvidence?: boolean;
	/** Character count of the evidence text that the technique got. */
	evidenceLength?: number;
}





export interface TechniqueResult {
	id: string;
	status: "success" | "failed";
	
	output?: unknown;
	
	error?: string;
	
	durationMs?: number;
	/** Number of model calls made. 1 means the first output passed validation. */
	attempts?: number;
	/** Validation error from each failed attempt. Empty when attempt 1 passed. */
	retryErrors?: string[];
}
