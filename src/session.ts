

import { mkdir, readFile, writeFile, rename, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { TechniqueResult } from "./techniques/types.ts";
import type { AdversarialExchange } from "./adversarial.ts";
import type { SynthesisOutput } from "./synthesis.ts";





export type SessionStatus = "in_progress" | "completed" | "paused" | "cancelled" | "failed";

/** A full pipeline run gathers evidence again when the saved evidence is older than this. */
export const EVIDENCE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface SessionState {
	id: string;
	question: string;
	status: SessionStatus;
	statusReason?: string;
	evidenceText?: string;
	/** ISO time when the code gathered evidenceText. The staleness check uses it. */
	evidenceGatheredAt?: string;
	techniqueResults: Record<string, TechniqueResult>;
	adversarialExchanges: Record<string, AdversarialExchange>;
	synthesis?: SynthesisOutput;
	outputPath?: string;
	reportHtmlPath?: string;
	createdAt: string;
	updatedAt: string;
}





function questionHash(question: string): string {
	return createHash("sha256")
		.update(question.trim().toLowerCase())
		.digest("hex")
		.slice(0, 16);
}

function sessionDir(cwd: string): string {
	return join(cwd, ".pi", "sat12-sessions");
}

function sessionFilePath(cwd: string, question: string, customId?: string): string {
	const id = customId || questionHash(question);
	return join(sessionDir(cwd), `${id}.json`);
}





export async function loadSession(
	cwd: string,
	question: string,
	customId?: string,
): Promise<SessionState | null> {
	try {
		const path = sessionFilePath(cwd, question, customId);
		const raw = await readFile(path, "utf8");
		const data = JSON.parse(raw) as SessionState;
		return data;
	} catch {
		return null;
	}
}

export async function saveSession(cwd: string, state: SessionState): Promise<void> {
	try {
		const dir = sessionDir(cwd);
		await mkdir(dir, { recursive: true });
		state.updatedAt = new Date().toISOString();
		const path = sessionFilePath(cwd, state.question, state.id);
		const tmpPath = `${path}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
		await writeFile(tmpPath, JSON.stringify(state, null, 2), "utf8");
		await rename(tmpPath, path);
	} catch (err) {
		console.error("Failed to save session state:", err);
	}
}

export async function findLatestSession(cwd: string): Promise<SessionState | null> {
	try {
		const dir = sessionDir(cwd);
		const files = await readdir(dir);
		const jsonFiles = files.filter((f) => f.endsWith(".json"));
		if (jsonFiles.length === 0) return null;

		let latest: SessionState | null = null;
		for (const file of jsonFiles) {
			try {
				const raw = await readFile(join(dir, file), "utf8");
				const state = JSON.parse(raw) as SessionState;
				if (!latest || new Date(state.updatedAt) > new Date(latest.updatedAt)) {
					latest = state;
				}
			} catch {}
		}
		return latest;
	} catch {
		return null;
	}
}

export function createInitialSession(question: string, evidenceText?: string, customId?: string): SessionState {
	const now = new Date().toISOString();
	return {
		id: customId || questionHash(question),
		question,
		status: "in_progress",
		evidenceText,
		techniqueResults: {},
		adversarialExchanges: {},
		createdAt: now,
		updatedAt: now,
	};
}

export function formatSessionStatus(session: SessionState): string {
	const techKeys = Object.keys(session.techniqueResults || {});
	const techSucceeded = Object.values(session.techniqueResults || {}).filter(
		(r) => r.status === "success",
	).length;
	const advCount = Object.keys(session.adversarialExchanges || {}).length;
	const hasSynthesis = Boolean(session.synthesis);

	let nextAction = "";
	switch (session.status) {
		case "paused":
			nextAction = "Run `/sat12_continue` to resume execution from the last saved technique.";
			break;
		case "cancelled":
			nextAction = "Session abandoned by user. Run `/sat12 <question>` to start a new analysis.";
			break;
		case "completed":
			nextAction = "Analysis completed. Run `/sat12_report` to view or re-render the HTML report.";
			break;
		case "failed":
			nextAction = `Failed: ${session.statusReason ?? "Unknown error"}. Fix issue and run \`/sat12_continue\` to retry.`;
			break;
		case "in_progress":
			nextAction = "Analysis currently running or interrupted. Run `/sat12_continue` to continue.";
			break;
	}

	const lines: string[] = [
		`## SAT-12 Session Status`,
		"",
		`**Session ID:** \`${session.id}\``,
		`**Status:** \`${session.status.toUpperCase()}\`${session.statusReason ? ` (${session.statusReason})` : ""}`,
		`**Question:** ${session.question}`,
		`**Created:** ${session.createdAt}`,
		`**Last Updated:** ${session.updatedAt}`,
		"",
		`### Progress Breakdown`,
		`- **Techniques Completed:** ${techSucceeded}/12 (${techKeys.length} attempted)`,
		`- **Adversarial Debates:** ${advCount}/12 exchanges completed`,
		`- **Synthesis Assessment:** ${hasSynthesis ? "Completed" : "Pending"}`,
	];

	if (session.outputPath) {
		lines.push(`- **OKF Wiki Directory:** \`${session.outputPath}\``);
	}
	if (session.reportHtmlPath) {
		lines.push(`- **HTML Executive Report:** \`${session.reportHtmlPath}\``);
	}

	lines.push("", `### Next Action`, nextAction);

	return lines.join("\n");
}
