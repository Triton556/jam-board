// These captures preserve historical evidence, not current executable examples.
import { readFileSync } from "node:fs";

export function assertHistoricalCapture(
	scriptUrl,
	{
		version = JSON.parse(
			readFileSync(
				new URL("../apps/desktop/package.json", import.meta.url),
				"utf8",
			),
		).version,
		argv = process.argv,
	} = {},
) {
	const script = new URL(scriptUrl).pathname.split("/").at(-1);
	// 0.2.0 is the importing checkout's provenance, NOT a compatibility claim:
	// several captures predate even that contract. Revalidation is still required.
	if (
		version !== "0.2.0" ||
		!argv.includes("--historical-contract-revalidated")
	) {
		throw new Error(
			`${script} is a historical capture, not a supported current smoke test. ` +
				`Refusing before writes/process launches (checkout ${version}; recorded provenance 0.2.0). ` +
				"Use scripts/stdio-smoke.mjs for current isolated MCP checks. To reproduce historical evidence, " +
				"review the matching source, binary, payloads and disposable data first; only a revalidated " +
				"0.2.0 checkout accepts --historical-contract-revalidated. This flag does not make old contracts compatible.",
		);
	}
}
