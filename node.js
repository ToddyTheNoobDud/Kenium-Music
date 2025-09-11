const { spawn } = require("node:child_process");
const path = require("node:path");

console.log("Starting TypeScript execution...\n");

const tsFile = path.join(__dirname, "index.ts");
const child = spawn("npx", ["tsx", tsFile], {
	stdio: "inherit", // This passes through all console output
	shell: true,
});

child.on("close", (code) => {
	console.log(`\n--- Process finished with code ${code} ---`);
	console.log("Press any key to exit...");
	process.stdin.setRawMode(true);
	process.stdin.resume();
	process.stdin.on("data", () => process.exit(0));
});

child.on("error", (error) => {
	console.error("Failed to start process:", error);
});
