

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, extname, isAbsolute } from "node:path";
import { createRequire } from "node:module";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadSourceManifest, resolveAdmiraltyRating, formatAdmiraltyHeader } from "./admiralty.ts";


const require = createRequire(import.meta.url);
let chunkMarkdown: any;
let scoreAllRelevance: any;

try {
	const chunkerModule = require("pi-webaio/dist/src/chunker.js");
	chunkMarkdown = chunkerModule.chunkMarkdown;
	const bm25Module = require("pi-webaio/dist/src/bm25.js");
	scoreAllRelevance = bm25Module.scoreAllRelevance;
} catch {
	
	chunkMarkdown = (text: string) => {
		const paragraphs = text.split(/\n\n+/).filter((p) => p.trim().length > 0);
		return paragraphs.map((p, idx) => ({ text: p, index: idx }));
	};
	scoreAllRelevance = (docs: string[], query: string) => {
		const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
		return docs.map((doc) => {
			const lower = doc.toLowerCase();
			let matches = 0;
			for (const term of terms) {
				if (lower.includes(term)) matches++;
			}
			return matches;
		});
	};
}





const SECRET_PATTERNS = [
	/\.env(\..+)?$/i,
	/\.pem$/i,
	/\.key$/i,
	/id_rsa/i,
	/credentials\.json$/i,
	/token.*\.json$/i,
	/secret.*\.json$/i,
];

const IGNORE_DIRS = new Set([
	".git",
	"node_modules",
	"dist",
	"build",
	"out",
	"coverage",
	".sat12",
	".pi",
	".vscode",
]);

const CODE_EXTENSIONS = new Set([
	".ts",
	".tsx",
	".js",
	".jsx",
	".py",
	".rs",
	".go",
	".java",
	".c",
	".cpp",
	".h",
	".cs",
	".rb",
	".php",
]);

const DOC_EXTENSIONS = new Set([
	".md",
	".markdown",
	".txt",
	".json",
	".csv",
	".yaml",
	".yml",
	".toml",
	".rst",
]);

export const MAX_LOCAL_EVIDENCE_TOKENS = 12000;
export const MAX_SINGLE_FILE_BYTES = 500000; 






export function extractCodeOutline(code: string, ext: string): string {
	const lines = code.split(/\r?\n/);
	const outlineLines: string[] = [];
	let inBlockComment = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const trimmed = line.trim();

		if (trimmed.startsWith("") && trimmed.length > 2) inBlockComment = false;
			continue;
		}

		if (inBlockComment) {
			outlineLines.push(line);
			if (trimmed.endsWith("*/") || trimmed.endsWith('"""') || trimmed.endsWith("'''")) {
				inBlockComment = false;
			}
			continue;
		}

		
		if (trimmed.startsWith("
			outlineLines.push(line);
			continue;
		}

		
		if (
			/^(export\s+)?(async\s+)?(function|class|interface|type|enum|struct|trait|impl|def)\b/.test(trimmed) ||
			/^(public|private|protected|static|readonly|fn|pub|const|let|var)\b/.test(trimmed) ||
			/^[a-zA-Z0-9_$]+\s*\(.*?\)\s*(:|=>|{)/.test(trimmed)
		) {
			
			const header = line.replace(/\{.*$/, "{ ... }");
			outlineLines.push(header);
			continue;
		}

		
		if (/^(import|export|require|from|package|use|include)\b/.test(trimmed)) {
			outlineLines.push(line);
			continue;
		}
	}

	
	if (outlineLines.length < 3 && lines.length > 0) {
		return lines.slice(0, 50).join("\n") + (lines.length > 50 ? "\n
	}

	return outlineLines.join("\n");
}





export interface ScannedFile {
	relativePath: string;
	absolutePath: string;
	isCode: boolean;
	content: string;
}

export async function listLocalFiles(
	dirPath: string,
	baseDir: string = dirPath,
): Promise<ScannedFile[]> {
	const scanned: ScannedFile[] = [];

	async function walk(currentDir: string) {
		let entries;
		try {
			entries = await readdir(currentDir, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries) {
			const name = entry.name;
			if (IGNORE_DIRS.has(name) || name.startsWith(".")) continue;

			const fullPath = join(currentDir, name);
			const relPath = relative(baseDir, fullPath);

			if (entry.isDirectory()) {
				await walk(fullPath);
			} else if (entry.isFile()) {
				
				if (SECRET_PATTERNS.some((pat) => pat.test(name))) continue;

				const ext = extname(name).toLowerCase();
				const isCode = CODE_EXTENSIONS.has(ext);
				const isDoc = DOC_EXTENSIONS.has(ext);

				if (!isCode && !isDoc) continue;

				try {
					const fileStats = await stat(fullPath);
					if (fileStats.size > MAX_SINGLE_FILE_BYTES) continue;

					const content = await readFile(fullPath, "utf8");
					scanned.push({
						relativePath: relPath,
						absolutePath: fullPath,
						isCode,
						content,
					});
				} catch {
					
				}
			}
		}
	}

	await walk(dirPath);
	return scanned;
}





export async function gatherLocalDirectoryEvidence(
	dirPath: string | undefined,
	question: string,
	_signal?: AbortSignal,
	ctx?: ExtensionContext,
	userOverrides?: Record<string, string>,
): Promise<string | undefined> {
	if (!dirPath) return undefined;

	const rootDir = ctx?.cwd || process.cwd();
	const resolvedDir = isAbsolute(dirPath) ? dirPath : join(rootDir, dirPath);

	let isDir = false;
	try {
		const s = await stat(resolvedDir);
		isDir = s.isDirectory();
	} catch {
		return undefined;
	}

	if (!isDir) return undefined;

	const manifest = await loadSourceManifest(resolvedDir);
	const scannedFiles = await listLocalFiles(resolvedDir);
	if (scannedFiles.length === 0) return undefined;

	const docChunks: Array<{ file: string; text: string }> = [];
	const codeOutlines: Array<{ file: string; outline: string }> = [];

	for (const file of scannedFiles) {
		const ext = extname(file.relativePath).toLowerCase();
		if (file.isCode) {
			const outline = extractCodeOutline(file.content, ext);
			codeOutlines.push({ file: file.relativePath, outline });
		} else {
			const chunks = chunkMarkdown(file.content);
			for (const c of chunks) {
				docChunks.push({ file: file.relativePath, text: c.text });
			}
		}
	}

	
	let rankedPassages: Array<{ file: string; text: string; score: number }> = [];
	if (docChunks.length > 0) {
		const chunkTexts = docChunks.map((c) => c.text);
		const scores: number[] = scoreAllRelevance(chunkTexts, question);

		rankedPassages = docChunks
			.map((c, idx) => ({ ...c, score: scores[idx] || 0 }))
			.sort((a, b) => b.score - a.score)
			.slice(0, 15); 
	}

	const sections: string[] = [
		`## Local Directory Evidence (@${relative(rootDir, resolvedDir) || dirPath})`,
		`Query-aware evidence gathered from target local directory \`${resolvedDir}\` (${scannedFiles.length} files scanned):`,
	];

	if (rankedPassages.length > 0) {
		sections.push("### Top Query-Relevant Document Passages (Ranked via Okapi BM25)");
		for (const p of rankedPassages) {
			const rating = resolveAdmiraltyRating(p.file, manifest, userOverrides, false);
			const admHeader = formatAdmiraltyHeader(rating);
			sections.push(`- **[Local File: \`${p.file}\` | BM25 Score: ${p.score.toFixed(2)} | ${admHeader}]**\n> ${p.text.replace(/\n/g, "\n> ")}`);
		}
	}

	if (codeOutlines.length > 0) {
		sections.push("### Structural Code Architecture & Interface Outlines");
		for (const c of codeOutlines.slice(0, 10)) {
			const rating = resolveAdmiraltyRating(c.file, manifest, userOverrides, false);
			const admHeader = formatAdmiraltyHeader(rating);
			sections.push(`#### [Source: \`${c.file}\` | ${admHeader}]\n\`\`\`\n${c.outline.trim()}\n\`\`\``);
		}
	}

	return sections.join("\n\n");
}
