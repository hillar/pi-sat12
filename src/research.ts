

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { checkAborted, isAbortError } from "./llm.ts";
import { gatherLocalDirectoryEvidence } from "./local_evidence.ts";






function resolveWebaioMcpBin(): string | undefined {
	try {
		
		const require = createRequire(import.meta.url);
		return require.resolve("pi-webaio/bin/pi-webaio-mcp.mjs");
	} catch {
		return undefined;
	}
}

/** Return true when the pi-webaio MCP server binary resolves. This means the package is installed. */
export function isWebaioInstalled(): boolean {
	return resolveWebaioMcpBin() !== undefined;
}

/** Message to show when the command needs pi-webaio but it is not installed. */
export const WEBAIO_INSTALL_HINT =
	"pi-webaio is not installed, so live web research cannot run. Install it with `npm install pi-webaio` (or add it as an extension), then retry.";

async function createMcpClient(
	ctx?: ExtensionContext,
	onUpdate?: (details: ResearchUpdateDetails) => void,
): Promise<Client | undefined> {
	const binPath = resolveWebaioMcpBin();
	if (!binPath) return undefined;

	
	
	let Client: typeof import("@modelcontextprotocol/sdk/client/index.js").Client;
	let StdioClientTransport: typeof import("@modelcontextprotocol/sdk/client/stdio.js").StdioClientTransport;
	try {
		({ Client } = await import("@modelcontextprotocol/sdk/client/index.js"));
		({ StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js"));
	} catch {
		return undefined;
	}

	try {
		const transport = new StdioClientTransport({
			command: process.execPath, 
			args: [binPath],
			stderr: "pipe",
		});

		
		if (transport.stderr) {
			let buffer = "";
			transport.stderr.on("data", (chunk: Buffer | string) => {
				buffer += chunk.toString();
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";

				for (const rawLine of lines) {
					const line = rawLine.trim();
					if (!line) continue;

					if (line.includes("HTTP 429") || line.includes("rate limit") || line.includes("Rate limit")) {
						const cleanMsg = "Web search rate-limited (HTTP 429); retrying with fallback provider...";
						if (ctx?.ui?.notify) {
							ctx.ui.notify(cleanMsg, "warning");
						} else {
							onUpdate?.({ phase: "research", status: "searching", reason: cleanMsg });
						}
					}
				}
			});
		}

		const client = new Client({ name: "sat12", version: "0.1.0" }, { capabilities: {} });
		await client.connect(transport);
		return client;
	} catch {
		return undefined;
	}
}






function extractBundleDir(text: string): string | undefined {
	const match = text.match(/Research bundle written to (.+?)(?:\n|$)/);
	return match?.[1]?.trim();
}


export async function loadPriorWorkspaceIntelligence(cwd: string): Promise<string | undefined> {
	try {
		const entries = await readdir(cwd, { withFileTypes: true });
		const analysisDirs = entries
			.filter((e) => e.isDirectory() && e.name.startsWith("analysis-"))
			.map((e) => e.name)
			.sort()
			.reverse()
			.slice(0, 5); 

		if (analysisDirs.length === 0) return undefined;

		const blocks: string[] = [];

		for (const dirName of analysisDirs) {
			const dirPath = join(cwd, dirName);
			let question = "Unknown Question";
			let bottomLine = "";
			const gaps: string[] = [];

			try {
				const rootIndex = await readFile(join(dirPath, "index.md"), "utf8");
				const qMatch = rootIndex.match(/\*\*Question:\*\*\s*(.+?)(?:\n|$)/);
				if (qMatch) question = qMatch[1].trim();

				const blMatch = rootIndex.match(/## Bottom-Line Assessment\s*\n+([\s\S]+?)(?=\n\n## |$)/);
				if (blMatch) bottomLine = blMatch[1].trim();
			} catch {
				
			}

			try {
				const gapsContent = await readFile(join(dirPath, "evidence", "gaps.md"), "utf8");
				const lines = gapsContent.split("\n");
				for (const line of lines) {
					if (line.trim().startsWith("- ") && !line.includes("_No gaps identified._")) {
						gaps.push(line.trim().slice(2));
					}
				}
			} catch {
				
			}

			if (bottomLine || gaps.length > 0) {
				const lines = [`### Previous Analysis Bundle: \`${dirName}\``, `**Question:** ${question}`];
				if (bottomLine) {
					lines.push(`**Bottom-Line Assessment:** ${bottomLine}`);
				}
				if (gaps.length > 0) {
					lines.push(`**Unresolved Intelligence Gaps:**\n${gaps.map((g) => `- ${g}`).join("\n")}`);
				}
				blocks.push(lines.join("\n"));
			}
		}

		if (blocks.length === 0) return undefined;

		return [
			"## Prior Workspace Intelligence & Previous Analysis Bundles",
			"",
			"The following prior analysis findings and unresolved intelligence gaps were discovered in this workspace:",
			"",
			...blocks,
		].join("\n\n");
	} catch {
		return undefined;
	}
}

export function attachResearchNotice(content: string | undefined, reason: string): string | undefined {
	if (!content) return undefined;
	const notice = [
		`> ⚠️ **Research Notice: Live Web Search Unsuccessful**`,
		`> Live web research could not retrieve fresh external data (${reason}).`,
		`> Analysis is proceeding based on prior workspace intelligence and user-provided context.`,
		`> **Analytical Directive:** Factor this limitation into Quality of Information Check (\`quality\`), consider source timeliness in Key Assumptions (\`assumptions\`), and log missing live data as an Unresolved Intelligence Gap.`,
	].join("\n");

	return `${notice}\n\n${content}`;
}





export interface ResearchUpdateDetails {
	phase: "research";
	status: "started" | "searching" | "reading" | "completed" | "skipped" | "failed";
	reason?: string;
	sourceCount?: number;
}

export async function gatherResearch(
	question: string,
	signal: AbortSignal | undefined,
	onUpdate: ((details: ResearchUpdateDetails) => void) | undefined,
	ctx?: ExtensionContext,
	evidenceDir?: string,
	userOverrides?: Record<string, string>,
): Promise<string | undefined> {
	checkAborted(signal, ctx);
	onUpdate?.({ phase: "research", status: "started" });

	const cwd = ctx?.cwd || process.cwd();
	const priorContext = await loadPriorWorkspaceIntelligence(cwd);
	const localEvidence = await gatherLocalDirectoryEvidence(evidenceDir, question, signal, ctx, userOverrides);

	const combineEvidence = (webText?: string, noticeReason?: string) => {
		const parts: string[] = [];
		if (noticeReason) {
			const notice = attachResearchNotice(priorContext || "Context provided", noticeReason);
			if (notice) parts.push(notice);
		} else if (priorContext) {
			parts.push(priorContext);
		}

		if (localEvidence) {
			parts.push(localEvidence);
		}

		if (webText) {
			parts.push(`# External Web Research & Evidence\n\n${webText}`);
		}

		return parts.length > 0 ? parts.join("\n\n") : undefined;
	};

	const client = await createMcpClient(ctx, onUpdate);
	if (!client) {
		const reason = (priorContext || localEvidence)
			? "pi-webaio MCP server unavailable; using prior workspace and local intelligence"
			: "pi-webaio MCP server unavailable (package not installed or failed to start)";
		onUpdate?.({
			phase: "research",
			status: (priorContext || localEvidence) ? "completed" : "skipped",
			reason,
		});
		return combineEvidence(undefined, reason);
	}

	checkAborted(signal, ctx);
	onUpdate?.({ phase: "research", status: "searching" });

	let bundleDir: string | undefined;
	let fallbackText: string | undefined;

	try {
		const result = await (client as any).callTool({
			name: "aio-webresearch",
			arguments: {
				query: question,
				maxSources: 8,
				writeBundle: true,
				
			},
		});

		checkAborted(signal, ctx);

		
		const text: string = result?.content?.[0]?.text ?? "";
		bundleDir = extractBundleDir(text);
		fallbackText = text;
	} catch (err) {
		if (isAbortError(err) || signal?.aborted || ctx?.signal?.aborted) {
			await client.close().catch(() => {});
			throw err;
		}
		const rawErr = err instanceof Error ? err.message : String(err);
		const cleanReason = rawErr.includes("429")
			? "Web search rate-limited (HTTP 429); proceeding with prior evidence"
			: `Web research call notice: ${rawErr.slice(0, 120)}`;

		if (ctx?.ui?.notify) {
			ctx.ui.notify(cleanReason, "warning");
		}

		onUpdate?.({
			phase: "research",
			status: (priorContext || localEvidence) ? "completed" : "failed",
			reason: cleanReason,
		});
		await client.close().catch(() => {});
		return combineEvidence(undefined, cleanReason);
	} finally {
		await client.close().catch(() => {});
	}

	let webEvidence: string | undefined;

	
	if (bundleDir) {
		onUpdate?.({ phase: "research", status: "reading" });
		try {
			const evidencePath = join(bundleDir, "reports", "EVIDENCE.md");
			const evidenceText = await readFile(evidencePath, "utf8");
			if (evidenceText.trim()) {
				webEvidence = evidenceText;
			}
		} catch {
			
		}
	}

	if (!webEvidence && fallbackText?.trim()) {
		webEvidence = fallbackText;
	}

	if (webEvidence) {
		onUpdate?.({ phase: "research", status: "completed" });
		return combineEvidence(webEvidence);
	}

	if (priorContext || localEvidence) {
		onUpdate?.({ phase: "research", status: "completed" });
		return combineEvidence(undefined, "no live web evidence returned");
	}

	onUpdate?.({ phase: "research", status: "skipped", reason: "no evidence content returned" });
	return undefined;
}
