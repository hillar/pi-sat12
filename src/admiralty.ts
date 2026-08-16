

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


export interface AdmiraltySourceEntry {
	source_id: string;
	admiralty_code?: string;
	reliability?: SourceReliability;
	credibility: InfoCredibility;
	corroborated_by?: string[];
	user_overridden?: boolean;
}

/**
 * Return the user override code for `sourceId`.
 * Match the key by exact text or by path prefix.
 * Use the same match rules as resolveAdmiraltyRating.
 */
function findUserOverrideCode(
	sourceId: string,
	userOverrides: Record<string, string>,
): string | undefined {
	const cleanSource = sourceId.replace(/^@/, "").replace(/\/$/, "");
	if (userOverrides[sourceId]) return userOverrides[sourceId];
	if (userOverrides[cleanSource]) return userOverrides[cleanSource];
	for (const [key, codeVal] of Object.entries(userOverrides)) {
		const cleanKey = key.replace(/^@/, "").replace(/\/$/, "");
		if (cleanKey && (cleanSource === cleanKey || cleanSource.startsWith(`${cleanKey}/`))) {
			return codeVal;
		}
	}
	return undefined;
}

export function validateAdmiraltySemantics(
	sourceRatings: AdmiraltySourceEntry[],
	options?: { userOverrides?: Record<string, string> },
): string | null {
	const userOverrides = options?.userOverrides;
	const ids = new Set<string>();

	for (const s of sourceRatings) {
		// REQ-ADM-2: Each source_id must appear exactly once in the sources list.
		// Rule 2: do not allow a duplicate source_id.
		if (ids.has(s.source_id)) {
			return `Duplicate source_id "${s.source_id}". Each source must appear exactly once.`;
		}
		ids.add(s.source_id);
	}

	for (const s of sourceRatings) {
		// REQ-ADM-1: The admiralty_code must equal reliability letter plus credibility number.
		// Rule 1: admiralty_code must equal reliability plus credibility.
		if (s.admiralty_code && s.reliability) {
			const expected = `${s.reliability}${s.credibility}`;
			if (s.admiralty_code.toUpperCase() !== expected) {
				return `Source "${s.source_id}" has admiralty_code "${s.admiralty_code}" but reliability/credibility fields imply "${expected}". They must agree.`;
			}
		}

		// REQ-ADM-3: Each corroborated_by id must exist in the sources list. A source must not list itself.
		// Rule 3: each corroborated_by id must exist. A source must not list itself.
		if (s.corroborated_by) {
			for (const ref of s.corroborated_by) {
				if (ref === s.source_id) {
					return `Source "${s.source_id}" lists itself in corroborated_by. A source cannot corroborate itself.`;
				}
				if (!ids.has(ref)) {
					return `Source "${s.source_id}" is corroborated_by "${ref}", which is not present in the sources list. Corroborating sources must be enumerated.`;
				}
			}
		}

		// REQ-ADM-5: An unverified user_overridden flag must not fail validation.
		// REQ-ADM-6: When a real user override exists, the emitted code must match it.
		// Rule 6: when a real user override exists, the emitted code must match it.
		// Do not fail when user_overridden is set but no override exists. The model
		// cannot see the user ratings for web sources, so it cannot verify the flag.
		// Rule 4 below checks the override itself, so a false flag still cannot
		// bypass the corroboration rule. Ignore the unverified flag instead.
		if (s.user_overridden) {
			const overrideCode = userOverrides ? findUserOverrideCode(s.source_id, userOverrides) : undefined;
			if (overrideCode && s.admiralty_code && s.admiralty_code.toUpperCase() !== overrideCode.toUpperCase()) {
				return `Source "${s.source_id}" is user_overridden to "${overrideCode}" but emitted code "${s.admiralty_code}". Use the user-supplied rating.`;
			}
		}

		// REQ-ADM-4: Credibility "1" (Confirmed) needs corroboration or a valid user override.
		// Rule 4: credibility "1" (Confirmed) needs corroboration or a valid override.
		if (s.credibility === "1") {
			const hasCorroboration = (s.corroborated_by?.length ?? 0) >= 1;
			const validOverride = Boolean(
				s.user_overridden && userOverrides && findUserOverrideCode(s.source_id, userOverrides),
			);
			if (!hasCorroboration && !validOverride) {
				return `Source "${s.source_id}" is rated credibility "1" (Confirmed) but lists no corroborating sources. Single-source reporting cannot be rated "1" without at least one independent corroborating source (list them in corroborated_by) or an explicit user override.`;
			}
		}
	}
	return null;
}
