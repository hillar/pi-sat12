

import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export interface Sat12Config {
	primary_model?: string;
	challenger_model?: string;
	investigator_model?: string;
	adversarial_enabled?: boolean;
	adversarial_mode?: "dual" | "trident";
	research_enabled?: boolean;
	gap_resolution_enabled?: boolean;
}

function getConfigPath(): string {
	return join(homedir(), ".pi", "sat12", "config.json");
}

export async function loadSat12Config(): Promise<Sat12Config> {
	try {
		const path = getConfigPath();
		const raw = await readFile(path, "utf8");
		return JSON.parse(raw) as Sat12Config;
	} catch {
		return {};
	}
}

export async function saveSat12Config(config: Sat12Config): Promise<void> {
	try {
		const path = getConfigPath();
		const dir = join(homedir(), ".pi", "sat12");
		await mkdir(dir, { recursive: true });
		const tmpPath = `${path}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
		await writeFile(tmpPath, JSON.stringify(config, null, 2), "utf8");
		await rename(tmpPath, path);
	} catch (err) {
		console.error("Failed to save sat12 config:", err);
	}
}

export async function setSat12Setting(
	key: string,
	value: string,
): Promise<{ config: Sat12Config; normalizedKey: string; normalizedValue: any }> {
	const config = await loadSat12Config();
	const k = key.toLowerCase().trim();

	if (k === "primary" || k === "primary_model") {
		config.primary_model = value;
		await saveSat12Config(config);
		return { config, normalizedKey: "primary_model", normalizedValue: value };
	}
	if (k === "challenger" || k === "challenger_model") {
		config.challenger_model = value;
		await saveSat12Config(config);
		return { config, normalizedKey: "challenger_model", normalizedValue: value };
	}
	if (k === "investigator" || k === "investigator_model") {
		config.investigator_model = value;
		await saveSat12Config(config);
		return { config, normalizedKey: "investigator_model", normalizedValue: value };
	}
	if (k === "adversarial_enabled") {
		const boolVal = value.toLowerCase() === "true" || value.toLowerCase() === "on";
		config.adversarial_enabled = boolVal;
		await saveSat12Config(config);
		return { config, normalizedKey: "adversarial_enabled", normalizedValue: boolVal };
	}
	if (k === "adversarial_mode") {
		const modeVal = value.toLowerCase() === "trident" ? "trident" : "dual";
		config.adversarial_mode = modeVal;
		await saveSat12Config(config);
		return { config, normalizedKey: "adversarial_mode", normalizedValue: modeVal };
	}
	if (k === "research_enabled") {
		const boolVal = value.toLowerCase() === "true" || value.toLowerCase() === "on";
		config.research_enabled = boolVal;
		await saveSat12Config(config);
		return { config, normalizedKey: "research_enabled", normalizedValue: boolVal };
	}
	if (k === "gap_resolution_enabled") {
		const boolVal = value.toLowerCase() === "true" || value.toLowerCase() === "on";
		config.gap_resolution_enabled = boolVal;
		await saveSat12Config(config);
		return { config, normalizedKey: "gap_resolution_enabled", normalizedValue: boolVal };
	}

	throw new Error(`Unknown setting key '${key}'`);
}

export async function setSat12Model(
	role: "primary" | "challenger" | "investigator",
	modelId: string,
): Promise<Sat12Config> {
	const res = await setSat12Setting(role, modelId);
	return res.config;
}
