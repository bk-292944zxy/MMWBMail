const path = require("node:path");
const { copyFileSync, existsSync, mkdirSync } = require("node:fs");
const { spawnSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const cacheRoot = path.join(projectRoot, ".cache");
const homeCache = path.join(cacheRoot, "home");
const npmCache = path.join(cacheRoot, "npm");
const nativeCacheRoot = path.join(cacheRoot, "native", "better-sqlite3");
const runtimeBinary = path.join(
  projectRoot,
  "node_modules",
  "better-sqlite3",
  "build",
  "Release",
  "better_sqlite3.node"
);
const cachedNodeBinary = path.join(nativeCacheRoot, "node.node");
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";

mkdirSync(homeCache, { recursive: true });
mkdirSync(npmCache, { recursive: true });
mkdirSync(nativeCacheRoot, { recursive: true });

if (existsSync(cachedNodeBinary)) {
  mkdirSync(path.dirname(runtimeBinary), { recursive: true });
  copyFileSync(cachedNodeBinary, runtimeBinary);
  console.log("Restored cached better-sqlite3 binary for Node runtime.");
  process.exit(0);
}

const result = spawnSync(npmBin, ["rebuild", "better-sqlite3"], {
  cwd: projectRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    HOME: homeCache,
    USERPROFILE: homeCache,
    npm_config_cache: npmCache
  }
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

if ((result.status ?? 0) !== 0) {
  process.exit(result.status ?? 1);
}

if (!existsSync(runtimeBinary)) {
  console.error("Node rebuild completed but better-sqlite3 binary was not produced.");
  process.exit(1);
}

copyFileSync(runtimeBinary, cachedNodeBinary);
console.log("Rebuilt better-sqlite3 for Node runtime and updated local cache.");
process.exit(0);
