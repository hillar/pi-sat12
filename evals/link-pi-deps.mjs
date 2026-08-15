/**
 * Link the packages that Pi provides at run time into local node_modules.
 *
 * This project is not installed with npm. Pi loads it from source with
 * `pi -e ./src/index.ts`, so `typebox` and `@earendil-works/*` resolve from
 * Pi's own install. Tests and type checks run outside Pi, so they need the
 * same packages on disk. This script makes symlinks instead of downloading
 * copies. That keeps the test versions equal to the run-time versions.
 *
 * Run: node evals/link-pi-deps.mjs
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, symlinkSync, rmSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PI_PACKAGE = "@earendil-works/pi-coding-agent";

/** Packages that Pi provides. Link each one from the Pi install. */
const LINKED_PACKAGES = [
	PI_PACKAGE,
	"@earendil-works/pi-ai",
	"@earendil-works/pi-agent-core",
	"typebox",
];

/** Return the global npm root, or undefined when npm is absent. */
function globalNodeModules() {
	try {
		return execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
	} catch {
		return undefined;
	}
}

/** Find the Pi install directory. */
function findPiRoot() {
	const candidates = [];
	const globalRoot = globalNodeModules();
	if (globalRoot) candidates.push(join(globalRoot, PI_PACKAGE));
	candidates.push(join("/usr/local/lib/node_modules", PI_PACKAGE));
	candidates.push(join("/opt/homebrew/lib/node_modules", PI_PACKAGE));

	for (const candidate of candidates) {
		if (existsSync(join(candidate, "package.json"))) return candidate;
	}
	return undefined;
}

/** Return the on-disk location of one package inside the Pi install. */
function resolveFromPi(piRoot, packageName) {
	const nested = join(piRoot, "node_modules", packageName);
	if (existsSync(join(nested, "package.json"))) return nested;

	// Pi itself is the root package, not a nested one.
	if (packageName === PI_PACKAGE) return piRoot;

	// npm may hoist a package beside Pi.
	const sibling = join(dirname(piRoot.replace(/\/@earendil-works$/, "")), packageName);
	if (existsSync(join(sibling, "package.json"))) return sibling;

	return undefined;
}

/** Replace any existing entry with a symlink to the target. */
function linkPackage(packageName, target) {
	const destination = join(PROJECT_ROOT, "node_modules", packageName);
	mkdirSync(dirname(destination), { recursive: true });
	if (existsSync(destination) || isBrokenLink(destination)) {
		rmSync(destination, { recursive: true, force: true });
	}
	symlinkSync(target, destination, "dir");
}

/** True when the path is a symlink whose target is gone. */
function isBrokenLink(path) {
	try {
		statSync(path);
		return false;
	} catch {
		try {
			// lstat succeeds for a broken link.
			statSync(path, { throwIfNoEntry: true });
			return false;
		} catch {
			return false;
		}
	}
}

function main() {
	const piRoot = findPiRoot();
	if (!piRoot) {
		console.error(
			`Cannot find ${PI_PACKAGE}. Install Pi first, then run this script again.`,
		);
		process.exit(1);
	}

	const missing = [];
	for (const packageName of LINKED_PACKAGES) {
		const target = resolveFromPi(piRoot, packageName);
		if (!target) {
			missing.push(packageName);
			continue;
		}
		linkPackage(packageName, target);
		console.log(`linked ${packageName} -> ${target}`);
	}

	if (missing.length > 0) {
		console.error(`Cannot find these packages in the Pi install: ${missing.join(", ")}`);
		process.exit(1);
	}
	console.log(`Linked ${LINKED_PACKAGES.length} packages from ${piRoot}`);
}

main();
