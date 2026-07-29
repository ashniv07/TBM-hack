// Starts the API dev server with a large heap (Stage 4 holds several parsed
// workbooks in memory at once and OOMs on Node's ~2GB default).
//
// Why a launcher instead of putting it in the npm script:
//   "NODE_OPTIONS=... ts-node-dev"          is POSIX-shell syntax; cmd.exe cannot parse it.
//   "cross-env NODE_OPTIONS=... ts-node-dev" needs a .cmd shim in node_modules/.bin, which
//                                            only exists if `npm install` was run on Windows.
// This repo gets installed from both WSL and PowerShell, so neither is reliable.
// require.resolve finds the module regardless of which platform wrote .bin.
const { spawn } = require("child_process");

const child = spawn(
  process.execPath,
  [require.resolve("ts-node-dev/lib/bin"), "--respawn", "--transpile-only", "src/server.ts"],
  {
    stdio: "inherit",
    cwd: __dirname,
    env: {
      ...process.env,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --max-old-space-size=8192`.trim(),
    },
  }
);

child.on("exit", (code) => process.exit(code ?? 0));
