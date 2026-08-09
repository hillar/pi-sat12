

import type { Message } from "@earendil-works/pi-ai";

export interface DepContext {
	techniqueId: string;
	techniqueName: string;
	outputText: string;
}


export function buildTechniqueUserMessage(
	question: string,
	evidenceText: string | undefined,
	depContexts: DepContext[],
): Message {
	const today = new Date().toISOString().slice(0, 10);

	const parts: string[] = [
		`Today's date is ${today}.\n`,
		`## Analytic Question\n\n${question}\n`,
	];

	if (evidenceText?.trim()) {
		parts.push(`## Evidence / Context\n\n${evidenceText.trim()}\n`);
		parts.push(
			`## Evidence Reliability Directive (Admiralty Evaluation)\n` +
			`Evidence passages and sources carry STANAG /  Admiralty ratings (A1 to F6):\n` +
			`- **A1, A2, B1, B2 (High Trust)**: Must carry maximum weight in hypothesis elimination (ACH), key assumptions, and synthesis.\n` +
			`- **D4, E4, F6 (Low Trust)**: Must be highlighted as high-risk vulnerabilities in Devil's Advocacy, Team A/B, and Red Team analysis.\n`
		);
	}

	if (depContexts.length > 0) {
		for (const dep of depContexts) {
			parts.push(
				`## Prior Finding: ${dep.techniqueName} (${dep.techniqueId})\n\n${dep.outputText}\n`,
			);
		}
	}

	return {
		role: "user" as const,
		content: parts.join("\n"),
		timestamp: Date.now(),
	};
}


export function formatTechniqueOutput(output: unknown): string {
	if (typeof output === "string") return output;
	return JSON.stringify(output, null, 2);
}
