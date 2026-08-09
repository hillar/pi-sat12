

import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type SourceReliability = "A" | "B" | "C" | "D" | "E" | "F";
export type InfoCredibility = "1" | "2" | "3" | "4" | "5" | "6";

export interface AdmiraltyRating {
	reliability: SourceReliability;
	credibility: InfoCredibility;
	code: string; 
	label: string; 
	source: "user_override" | "manifest_preset" | "auto_heuristic";
	notes?: string;
}

export interface SourceManifestEntry {
	reliability?: SourceReliability;
	credibility?: InfoCredibility;
	notes?: string;
}

export interface SourceManifest {
	sources?: Record<string, SourceManifestEntry>;
	defaultLocalRating?: { reliability?: SourceReliability; credibility?: InfoCredibility };
	defaultWebRating?: { reliability?: SourceReliability; credibility?: InfoCredibility };
}

export const RELIABILITY_LABELS: Record<SourceReliability, string> = {
	A: "Completely Reliable",
	B: "Usually Reliable",
	C: "Fairly Reliable",
	D: "Not Usually Reliable",
	E: "Unreliable",
	F: "Reliability Cannot Be Judged",
};

export const CREDIBILITY_LABELS: Record<InfoCredibility, string> = {
	"1": "Confirmed by Other Sources",
	"2": "Probably True",
	"3": "Possibly True",
	"4": "Doubtful",
	"5": "Improbable",
	"6": "Truth Cannot Be Judged",
};






export async function loadSourceManifest(dirPath: string): Promise<SourceManifest | undefined> {
	const pathsToTry = [
		join(dirPath, "sources.json"),
		join(dirPath, ".sat12", "sources.json"),
	];

	for (const p of pathsToTry) {
		try {
			const text = await readFile(p, "utf8");
			const json = JSON.parse(text) as SourceManifest;
			if (json && (json.sources || json.defaultLocalRating || json.defaultWebRating)) {
				return json;
			}
		} catch {
			
		}
	}

	return undefined;
}






export function resolveAdmiraltyRating(
	sourceId: string,
	manifest?: SourceManifest,
	userOverrides?: Record<string, string>,
	isWeb = false,
): AdmiraltyRating {
	
	if (userOverrides) {
		const cleanSource = sourceId.replace(/^@/, "").replace(/\/$/, "");

		
		if (userOverrides[sourceId] || userOverrides[cleanSource]) {
			const rawCode = userOverrides[sourceId] || userOverrides[cleanSource];
			const parsed = parseAdmiraltyCode(rawCode);
			if (parsed) {
				return {
					...parsed,
					source: "user_override",
					notes: "User manual file override",
				};
			}
		}

		
		for (const [key, codeVal] of Object.entries(userOverrides)) {
			const cleanKey = key.replace(/^@/, "").replace(/\/$/, "");
			if (cleanKey && (cleanSource === cleanKey || cleanSource.startsWith(`${cleanKey}/`))) {
				const parsed = parseAdmiraltyCode(codeVal);
				if (parsed) {
					return {
						...parsed,
						source: "user_override",
						notes: `User manual directory override (${cleanKey})`,
					};
				}
			}
		}
	}

	
	if (manifest?.sources) {
		
		for (const [pattern, entry] of Object.entries(manifest.sources)) {
			if (sourceId === pattern || sourceId.endsWith(`/${pattern}`) || patternMatches(sourceId, pattern)) {
				const rel = entry.reliability || "B";
				const cred = entry.credibility || "2";
				return {
					reliability: rel,
					credibility: cred,
					code: `${rel}${cred}`,
					label: `${rel}${cred} (${RELIABILITY_LABELS[rel]} / ${CREDIBILITY_LABELS[cred]})`,
					source: "manifest_preset",
					notes: entry.notes || "Directory manifest preset",
				};
			}
		}
	}

	
	if (!isWeb && manifest?.defaultLocalRating) {
		const rel = manifest.defaultLocalRating.reliability || "B";
		const cred = manifest.defaultLocalRating.credibility || "2";
		return {
			reliability: rel,
			credibility: cred,
			code: `${rel}${cred}`,
			label: `${rel}${cred} (${RELIABILITY_LABELS[rel]} / ${CREDIBILITY_LABELS[cred]})`,
			source: "manifest_preset",
		};
	}

	if (isWeb && manifest?.defaultWebRating) {
		const rel = manifest.defaultWebRating.reliability || "C";
		const cred = manifest.defaultWebRating.credibility || "3";
		return {
			reliability: rel,
			credibility: cred,
			code: `${rel}${cred}`,
			label: `${rel}${cred} (${RELIABILITY_LABELS[rel]} / ${CREDIBILITY_LABELS[cred]})`,
			source: "manifest_preset",
		};
	}

	
	let rel: SourceReliability = "B";
	let cred: InfoCredibility = "2";

	if (isWeb) {
		const lower = sourceId.toLowerCase();
		if (/\.(gov|edu)\b/.test(lower) || lower.includes("arxiv.org") || lower.includes("wikipedia.org")) {
			rel = "A";
			cred = "2";
		} else if (lower.includes("reddit.com") || lower.includes("stackoverflow.com") || lower.includes("forum")) {
			rel = "D";
			cred = "3";
		} else {
			rel = "C";
			cred = "3";
		}
	} else {
		
		const lower = sourceId.toLowerCase();
		if (/\.(ts|tsx|js|jsx|py|rs|go|java|c|cpp|h|json)$/.test(lower)) {
			rel = "B";
			cred = "2"; 
		} else {
			rel = "B";
			cred = "2";
		}
	}

	return {
		reliability: rel,
		credibility: cred,
		code: `${rel}${cred}`,
		label: `${rel}${cred} (${RELIABILITY_LABELS[rel]} / ${CREDIBILITY_LABELS[cred]})`,
		source: "auto_heuristic",
	};
}





export function parseAdmiraltyCode(
	raw: string,
): { reliability: SourceReliability; credibility: InfoCredibility; code: string; label: string } | undefined {
	const match = raw.trim().toUpperCase().match(/^([A-F])([1-6])$/);
	if (!match) return undefined;

	const rel = match[1] as SourceReliability;
	const cred = match[2] as InfoCredibility;
	return {
		reliability: rel,
		credibility: cred,
		code: `${rel}${cred}`,
		label: `${rel}${cred} (${RELIABILITY_LABELS[rel]} / ${CREDIBILITY_LABELS[cred]})`,
	};
}

export function formatAdmiraltyHeader(rating: AdmiraltyRating): string {
	const overrideNote = rating.source === "user_override" ? " [User Override]" : "";
	return `Admiralty: ${rating.label}${overrideNote}`;
}

function patternMatches(sourceId: string, pattern: string): boolean {
	if (pattern.includes("*")) {
		const regex = new RegExp(`^${pattern.replace(/\*/g, ".*")}$`);
		return regex.test(sourceId);
	}
	return false;
}


export function validateAdmiraltySemantics(
	sourceRatings: Array<{ source_id: string; credibility: InfoCredibility; user_overridden?: boolean }>,
	corroborationCounts?: Map<string, number>,
): string | null {
	for (const s of sourceRatings) {
		if (s.credibility === "1" && !s.user_overridden) {
			const count = corroborationCounts?.get(s.source_id) ?? 1;
			if (count < 2) {
				return `Source "${s.source_id}" is rated credibility "1" (Confirmed) but has only ${count} source. Single-source reporting cannot be rated "1" without multi-source corroboration or explicit user override.`;
			}
		}
	}
	return null;
}
