const { copyFileSync, existsSync, mkdirSync } = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const cacheRoot = path.join(projectRoot, ".cache");
const electronGypCache = path.join(cacheRoot, "electron-gyp");
const nodeGypCache = path.join(cacheRoot, "node-gyp");
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
const cachedElectronBinary = path.join(nativeCacheRoot, "electron.node");
const electronRebuildBin = path.join(
  projectRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "electron-rebuild.cmd" : "electron-rebuild"
);

mkdirSync(electronGypCache, { recursive: true });
mkdirSync(nodeGypCache, { recursive: true });
mkdirSync(homeCache, { recursive: true });
mkdirSync(npmCache, { recursive: true });
mkdirSync(nativeCacheRoot, { recursive: true });

if (existsSync(cachedElectronBinary)) {
  mkdirSync(path.dirname(runtimeBinary), { recursive: true });
  copyFileSync(cachedElectronBinary, runtimeBinary);
  spawnSync("xattr", ["-d", "com.apple.quarantine", runtimeBinary], {
    cwd: projectRoot,
    stdio: "ignore"
  });
  console.log("Restored cached better-sqlite3 binary for Electron runtime.");
  process.exit(0);
}

const env = {
  ...process.env,
  HOME: homeCache,
  USERPROFILE: homeCache,
  ELECTRON_GYP_CACHE: electronGypCache,
  npm_config_cache: npmCache,
  npm_config_devdir: nodeGypCache
};

const result = spawnSync(electronRebuildBin, ["-f", "-w", "better-sqlite3"], {
  cwd: projectRoot,
  stdio: "inherit",
  env
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

if ((result.status ?? 0) !== 0) {
  process.exit(result.status ?? 1);
}

if (!existsSync(runtimeBinary)) {
  console.error("Electron rebuild completed but better-sqlite3 binary was not produced.");
  process.exit(1);
}

const betterSqlitePath = path.join(projectRoot, "node_modules", "better-sqlite3");
const clearQuarantine = spawnSync("xattr", ["-dr", "com.apple.quarantine", betterSqlitePath], {
  cwd: projectRoot,
  stdio: "ignore"
});

if (clearQuarantine.error && clearQuarantine.error.code !== "ENOENT") {
  console.error(clearQuarantine.error.message);
  process.exit(1);
}

copyFileSync(runtimeBinary, cachedElectronBinary);
console.log("Rebuilt better-sqlite3 for Electron runtime and updated local cache.");
process.exit(0);
