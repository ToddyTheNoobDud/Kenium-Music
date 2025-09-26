const { spawn } = require("node:child_process")
const path = require("node:path")

console.log("Starting TypeScript execution...\n")

const tsFile = path.join(__dirname, "index.ts")

function runCommand(command, args) {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: true,
  })

  child.on("close", (code) => {
    console.log(`\n--- Process finished with code ${code} ---`)
    console.log("Press any key to exit...")
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.on("data", () => process.exit(0))
  })

  child.on("error", (error) => {
    console.error("Failed to start process:", error)
  })
}

if (process.isBun) {
  console.log("✅ Bun detected, starting with Bun...\n")
  runCommand("bun", [tsFile])
} else {
  console.log("⚠️ Not running in Bun, falling back to npm run startNode...\n")
  runCommand("npm", ["run", "startNode"])
}
