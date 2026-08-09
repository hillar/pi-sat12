

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
	
	semanticCheck?: (data: unknown) => string | null;
}





export interface TechniqueResult {
	id: string;
	status: "success" | "failed";
	
	output?: unknown;
	
	error?: string;
	
	durationMs?: number;
}
