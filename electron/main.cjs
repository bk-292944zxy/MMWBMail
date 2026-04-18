const path = require("node:path");
const process = require("node:process");
const fs = require("node:fs");
const http = require("node:http");
const { spawn } = require("node:child_process");

require("tsx/cjs");
require("dotenv/config");

const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const Module = require("node:module");

process.on("uncaughtException", (error) => {
  console.error("MAIN uncaughtException:", error);
});

process.on("unhandledRejection", (reason) => {
  console.error("MAIN unhandledRejection:", reason);
});

app.on("render-process-gone", (_event, _webContents, details) => {
  console.error("render-process-gone:", details);
});

app.on("child-process-gone", (_event, details) => {
  console.error("child-process-gone:", details);
});

app.on("gpu-process-crashed", (_event, killed) => {
  console.error("gpu-process-crashed:", { killed });
});

app.on("web-contents-created", (_event, contents) => {
  contents.on("render-process-gone", (_evt, details) => {
    console.error("contents render-process-gone:", details);
  });
});

const {
  ELECTRON_MAIL_CHANNELS
} = require("../lib/electron/ipc-contract.ts");
const {
  getServiceErrorMessage,
  getServiceErrorStatus
} = require("../lib/services/service-error.ts");

const isDevelopment = !app.isPackaged;
const startUrl = app.isPackaged
  ? "http://127.0.0.1:3000"
  : (process.env.ELECTRON_START_URL || "http://localhost:3000");
const PACKAGED_DB_FILENAME = "maximail.db";
const PACKAGED_DB_SEED_RELATIVE_PATH = path.join("seed", "blank-seed.db");
app.setName("MaxiMail");

let packagedServerProcess = null;
const fallbackLogPath = path.join(process.env.TMPDIR || "/tmp", "maximail-packaged-startup.log");
let aliasResolutionConfigured = false;

function resolveStartupLogPath() {
  try {
    if (app?.isReady?.()) {
      const userDataPath = app.getPath("userData");
      fs.mkdirSync(userDataPath, { recursive: true });
      return path.join(userDataPath, "startup.log");
    }
  } catch (_error) {
    // ignore and fall back
  }
  return fallbackLogPath;
}

function logLine(message, meta) {
  const payload = meta ? `${message} ${JSON.stringify(meta)}` : message;
  const line = `[${new Date().toISOString()}] ${payload}`;
  console.error(line);
  try {
    fs.appendFileSync(resolveStartupLogPath(), `${line}\n`, "utf8");
  } catch (_error) {
    // best effort logging only
  }
}

function configurePackagedAliasResolution() {
  if (!app.isPackaged || aliasResolutionConfigured) {
    return;
  }

  const originalResolveFilename = Module._resolveFilename;
  const appRoot = app.getAppPath();

  Module._resolveFilename = function patchedResolveFilename(request, parent, isMain, options) {
    if (typeof request === "string" && request.startsWith("@/")) {
      const aliasedRequest = path.join(appRoot, request.slice(2));
      return originalResolveFilename.call(this, aliasedRequest, parent, isMain, options);
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };

  aliasResolutionConfigured = true;
  logLine("packaged-runtime: alias-resolution-configured", { appRoot });
}

logLine("MAIN startup", {
  isDevelopment,
  isPackaged: app.isPackaged,
  startUrl,
  cwd: process.cwd(),
  resourcesPath: process.resourcesPath
});

function toIpcError(error, fallbackMessage) {
  const message = getServiceErrorMessage(error, fallbackMessage);
  const status = getServiceErrorStatus(error, 500);
  const ipcError = new Error(message);
  ipcError.name = "ElectronServiceError";
  ipcError.code = String(status);
  return ipcError;
}

function createMainWindow() {
  logLine("createMainWindow: begin");

  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#f5f2ee",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  logLine("createMainWindow: BrowserWindow created");

  window.once("ready-to-show", () => {
    logLine("window ready-to-show");
    window.show();
    if (process.env.ELECTRON_OPEN_DEVTOOLS === "true") {
      logLine("window opening devtools");
      window.webContents.openDevTools({ mode: "detach" });
    }
  });

  window.on("show", () => {
    logLine("window show");
  });

  window.on("closed", () => {
    logLine("window closed");
  });

  window.on("unresponsive", () => {
    logLine("window unresponsive");
  });

  window.webContents.on("did-start-loading", () => {
    logLine("webContents did-start-loading");
  });

  window.webContents.on("did-stop-loading", () => {
    logLine("webContents did-stop-loading");
  });

  window.webContents.on("did-finish-load", () => {
    logLine("webContents did-finish-load", {
      url: window.webContents.getURL()
    });
  });

  window.webContents.on("did-fail-load", (_event, code, description, validatedURL) => {
    logLine("webContents did-fail-load", {
      code,
      description,
      validatedURL
    });
  });

  window.webContents.on("dom-ready", () => {
    logLine("webContents dom-ready", {
      url: window.webContents.getURL()
    });
  });

  window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    logLine("renderer console-message", {
      level,
      message,
      line,
      sourceId
    });
  });

  logLine("createMainWindow: loadURL", { startUrl });
  window.loadURL(startUrl);

  if (isDevelopment) {
    window.webContents.on("did-fail-load", (_event, code, description) => {
      logLine("electron: failed to load renderer", { code, description, startUrl });
    });
  }

  return window;
}

function getPackagedDatabaseUrl(databasePath) {
  return `file:${databasePath}`;
}

function ensurePackagedDatabase() {
  if (!app.isPackaged) {
    return null;
  }

  const userDataPath = app.getPath("userData");
  const databasePath = path.join(userDataPath, PACKAGED_DB_FILENAME);
  const bundledSeedPath = path.join(process.resourcesPath, PACKAGED_DB_SEED_RELATIVE_PATH);

  fs.mkdirSync(userDataPath, { recursive: true });

  if (!fs.existsSync(databasePath)) {
    if (!fs.existsSync(bundledSeedPath)) {
      throw new Error(`Packaged seed database not found at ${bundledSeedPath}`);
    }

    fs.copyFileSync(bundledSeedPath, databasePath);
    logLine("packaged-db: seeded", { bundledSeedPath, databasePath });
  } else {
    logLine("packaged-db: existing", { databasePath });
  }

  const databaseUrl = getPackagedDatabaseUrl(databasePath);
  process.env.DATABASE_URL = databaseUrl;
  process.env.DIRECT_URL = databaseUrl;

  logLine("packaged-db: configured", {
    userDataPath,
    databasePath,
    databaseUrl
  });

  return { databasePath, databaseUrl };
}

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function findLegacySecretStoreCandidates() {
  const candidates = [];
  const seen = new Set();
  const startPath = app.getAppPath();
  let current = startPath;

  // Walk up from the packaged app path and look for previously-used local secret stores.
  for (let depth = 0; depth < 10; depth += 1) {
    const candidate = path.join(
      current,
      ".maximail-secrets",
      "mail-account-secrets.json"
    );
    if (!seen.has(candidate)) {
      seen.add(candidate);
      candidates.push(candidate);
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return candidates;
}

function mergeLegacySecretsIntoTarget(targetSecretsPath) {
  if (!app.isPackaged) {
    return;
  }

  const target = safeReadJson(targetSecretsPath) ?? {
    version: 1,
    mailAccountPasswords: {}
  };
  const targetPasswords =
    target && typeof target === "object" && target.mailAccountPasswords
      ? target.mailAccountPasswords
      : {};

  let mergedCount = 0;
  for (const candidatePath of findLegacySecretStoreCandidates()) {
    if (candidatePath === targetSecretsPath || !fs.existsSync(candidatePath)) {
      continue;
    }

    const candidate = safeReadJson(candidatePath);
    const candidatePasswords =
      candidate &&
      typeof candidate === "object" &&
      candidate.mailAccountPasswords &&
      typeof candidate.mailAccountPasswords === "object"
        ? candidate.mailAccountPasswords
        : null;

    if (!candidatePasswords) {
      continue;
    }

    for (const [accountId, encryptedSecret] of Object.entries(candidatePasswords)) {
      if (
        typeof encryptedSecret === "string" &&
        encryptedSecret.length > 0 &&
        typeof targetPasswords[accountId] !== "string"
      ) {
        targetPasswords[accountId] = encryptedSecret;
        mergedCount += 1;
      }
    }
  }

  if (mergedCount <= 0) {
    logLine("packaged-secrets: migration-skip");
    return;
  }

  fs.mkdirSync(path.dirname(targetSecretsPath), { recursive: true });
  fs.writeFileSync(
    targetSecretsPath,
    `${JSON.stringify({ version: 1, mailAccountPasswords: targetPasswords }, null, 2)}\n`,
    { mode: 0o600 }
  );
  logLine("packaged-secrets: migration-applied", {
    mergedCount
  });
}

function configurePackagedSecretStorePath() {
  if (!app.isPackaged) {
    return null;
  }

  const userDataPath = app.getPath("userData");
  const secretsPath = path.join(
    userDataPath,
    ".maximail-secrets",
    "mail-account-secrets.json"
  );
  process.env.LOCAL_SECRET_STORE_PATH = secretsPath;
  mergeLegacySecretsIntoTarget(secretsPath);
  logLine("packaged-secrets: configured", { secretsPath });
  return secretsPath;
}

function checkHttpReady(url) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume();
      resolve(response.statusCode && response.statusCode >= 200 && response.statusCode < 500);
    });
    request.setTimeout(1200, () => {
      request.destroy();
      resolve(false);
    });
    request.on("error", () => resolve(false));
  });
}

async function waitForLocalServer(url, timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (packagedServerProcess && packagedServerProcess.exitCode !== null) {
      return false;
    }
    // eslint-disable-next-line no-await-in-loop
    const ready = await checkHttpReady(url);
    if (ready) {
      return true;
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

function startPackagedLocalServer() {
  if (packagedServerProcess) {
    return packagedServerProcess;
  }

  const appEntry = path.join(app.getAppPath(), "app.js");
  const cwd = app.getAppPath();
  logLine("packaged-server: start", { appEntry, startUrl, cwd });

  packagedServerProcess = spawn(process.execPath, [appEntry], {
    cwd,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      PORT: "3000"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  packagedServerProcess.stdout?.on("data", (chunk) => {
    logLine("packaged-server: stdout", { line: String(chunk).trim() });
  });

  packagedServerProcess.stderr?.on("data", (chunk) => {
    logLine("packaged-server: stderr", { line: String(chunk).trim() });
  });

  packagedServerProcess.on("exit", (code, signal) => {
    logLine("packaged-server: exit", { code, signal });
    packagedServerProcess = null;
  });

  packagedServerProcess.on("error", (error) => {
    logLine("packaged-server: spawn-error", {
      message: error?.message ?? String(error)
    });
  });

  return packagedServerProcess;
}

function stopPackagedLocalServer() {
  if (!packagedServerProcess || packagedServerProcess.killed) {
    return;
  }
  logLine("packaged-server: stop");
  packagedServerProcess.kill();
}

function registerIpcHandlers() {
  logLine("registerIpcHandlers: begin");
  logLine("registerIpcHandlers: require account-management-service");
  const {
    createAccountService,
    listAccountsService,
    verifyAccountService
  } = require("../lib/services/account-management-service.ts");
  logLine("registerIpcHandlers: require account-mail-service");
  const {
    getAccountMessageDetailService,
    listAccountMessagesService,
    loadAccountFoldersService,
    sendAccountMessageService
  } = require("../lib/services/account-mail-service.ts");
  logLine("registerIpcHandlers: require compose-draft-service");
  const {
    saveComposeDraftService,
    loadComposeDraftService,
    listComposeDraftsService,
    deleteComposeDraftService
  } = require("../lib/services/compose-draft-service.ts");

  ipcMain.handle(ELECTRON_MAIL_CHANNELS.listAccounts, async () => {
    try {
      const accounts = await listAccountsService();
      return { accounts };
    } catch (error) {
      throw toIpcError(error, "Unable to load accounts.");
    }
  });

  ipcMain.handle(ELECTRON_MAIL_CHANNELS.verifyAccount, async (_event, payload) => {
    try {
      return await verifyAccountService(payload);
    } catch (error) {
      throw toIpcError(error, "Unable to verify account.");
    }
  });

  ipcMain.handle(ELECTRON_MAIL_CHANNELS.createAccount, async (_event, payload) => {
    try {
      const account = await createAccountService(payload);
      return { account };
    } catch (error) {
      throw toIpcError(error, "Unable to create account.");
    }
  });

  ipcMain.handle(ELECTRON_MAIL_CHANNELS.loadFolders, async (_event, input) => {
    try {
      const folders = await loadAccountFoldersService({
        accountId: input.accountId,
        shouldSync: input.sync === true,
        folderPaths: Array.isArray(input.folderPaths) ? input.folderPaths : undefined
      });
      return { folders };
    } catch (error) {
      throw toIpcError(error, "Unable to load folders.");
    }
  });

  ipcMain.handle(ELECTRON_MAIL_CHANNELS.loadMessages, async (_event, input) => {
    try {
      const messages = await listAccountMessagesService({
        accountId: input.accountId,
        folderPath: input.folderPath,
        query: input.query,
        mailboxType: input.mailboxType,
        sourceKind: input.sourceKind,
        mailboxSystemKey: input.mailboxSystemKey,
        shouldSync: input.shouldSync === true
      });
      return { messages };
    } catch (error) {
      throw toIpcError(error, "Unable to load messages.");
    }
  });

  ipcMain.handle(ELECTRON_MAIL_CHANNELS.loadMessageDetail, async (_event, input) => {
    try {
      const message = await getAccountMessageDetailService({
        accountId: input.accountId,
        folderPath: input.folderPath,
        uid: Number(input.uid)
      });
      return { message };
    } catch (error) {
      throw toIpcError(error, "Unable to load message.");
    }
  });

  ipcMain.handle(ELECTRON_MAIL_CHANNELS.sendMessage, async (_event, input) => {
    try {
      const attachments = Array.isArray(input?.payload?.attachments)
        ? input.payload.attachments
            .filter((entry) => typeof entry?.contentBase64 === "string")
            .map((entry) => ({
              filename: entry.filename,
              contentType: entry.contentType,
              cid: entry.cid,
              contentDisposition: entry.contentDisposition,
              content: Buffer.from(entry.contentBase64, "base64")
            }))
        : [];

      return await sendAccountMessageService(input.accountId, {
        ...input.payload,
        attachments
      });
    } catch (error) {
      throw toIpcError(error, "Unable to send message.");
    }
  });

  ipcMain.handle(ELECTRON_MAIL_CHANNELS.createDraft, async (_event, input) => {
    try {
      return await saveComposeDraftService(input);
    } catch (error) {
      throw toIpcError(error, "Unable to create draft.");
    }
  });

  ipcMain.handle(ELECTRON_MAIL_CHANNELS.saveDraft, async (_event, input) => {
    try {
      return await saveComposeDraftService(input);
    } catch (error) {
      throw toIpcError(error, "Unable to save draft.");
    }
  });

  ipcMain.handle(ELECTRON_MAIL_CHANNELS.loadDraft, async (_event, input) => {
    try {
      return await loadComposeDraftService(input ?? {});
    } catch (error) {
      throw toIpcError(error, "Unable to load draft.");
    }
  });

  ipcMain.handle(ELECTRON_MAIL_CHANNELS.listDrafts, async (_event, input) => {
    try {
      return await listComposeDraftsService(input ?? {});
    } catch (error) {
      throw toIpcError(error, "Unable to list drafts.");
    }
  });

  ipcMain.handle(ELECTRON_MAIL_CHANNELS.deleteDraft, async (_event, input) => {
    try {
      return await deleteComposeDraftService(input ?? {});
    } catch (error) {
      throw toIpcError(error, "Unable to delete draft.");
    }
  });

  ipcMain.handle(ELECTRON_MAIL_CHANNELS.printToPdf, async (_event, input) => {
    if (!input?.html || typeof input.html !== "string") {
      throw toIpcError(new Error("HTML content is required."), "Unable to generate PDF.");
    }

    const suggestedFilename =
      typeof input.suggestedFilename === "string" && input.suggestedFilename.trim().length > 0
        ? input.suggestedFilename.trim()
        : "message.pdf";

    const pdfWindow = new BrowserWindow({
      width: 794,
      height: 1123,
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });

    try {
      const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(input.html)}`;
      await pdfWindow.loadURL(dataUrl);
      await new Promise((resolve) => setTimeout(resolve, 500));

      const pdfBuffer = await pdfWindow.webContents.printToPDF({
        printBackground: true,
        pageSize: "Letter",
        margins: {
          marginType: "custom",
          top: 0.4,
          bottom: 0.4,
          left: 0.4,
          right: 0.4
        }
      });

      const result = await dialog.showSaveDialog({
        title: "Save as PDF",
        defaultPath: path.join(app.getPath("downloads"), suggestedFilename),
        filters: [{ name: "PDF Documents", extensions: ["pdf"] }]
      });

      if (result.canceled || !result.filePath) {
        return { saved: false, filePath: null };
      }

      fs.writeFileSync(result.filePath, pdfBuffer);
      return { saved: true, filePath: result.filePath };
    } catch (error) {
      throw toIpcError(error, "Unable to generate PDF.");
    } finally {
      pdfWindow.destroy();
    }
  });

  logLine("registerIpcHandlers: complete");
}

app.whenReady().then(async () => {
  logLine("app.whenReady: begin");

  if (app.isPackaged) {
    const packagedAppPath = app.getAppPath();
    process.chdir(packagedAppPath);
    logLine("packaged-runtime: cwd-aligned", {
      cwd: process.cwd(),
      appPath: packagedAppPath
    });
    configurePackagedAliasResolution();
  }
  try {
    ensurePackagedDatabase();
    configurePackagedSecretStorePath();
  } catch (error) {
    logLine("packaged-db: init-failure", {
      message: error?.message ?? String(error)
    });
    dialog.showErrorBox(
      "MaxiMail startup failed",
      `Database initialization failed.\n\n${error?.message ?? String(error)}\n\nLog: ${resolveStartupLogPath()}`
    );
    app.quit();
    return;
  }

  try {
    registerIpcHandlers();
  } catch (error) {
    logLine("registerIpcHandlers: failure", {
      message: error?.message ?? String(error),
      stack: error?.stack ?? null
    });
    dialog.showErrorBox(
      "MaxiMail startup failed",
      `IPC/service initialization failed.\n\n${error?.message ?? String(error)}\n\nLog: ${resolveStartupLogPath()}`
    );
    app.quit();
    return;
  }

  if (app.isPackaged) {
    startPackagedLocalServer();
    const ready = await waitForLocalServer(startUrl);
    if (!ready) {
      logLine("packaged-server: timeout/failure", { startUrl });
      dialog.showErrorBox(
        "MaxiMail startup failed",
        `Local server did not become ready at ${startUrl}.\n\nLog: ${resolveStartupLogPath()}`
      );
      app.quit();
      return;
    }
    logLine("packaged-server: ready", { startUrl });
  }

  createMainWindow();

  app.on("activate", () => {
    logLine("app activate");
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("before-quit", () => {
  stopPackagedLocalServer();
});

app.on("window-all-closed", () => {
  logLine("window-all-closed");
  if (process.platform !== "darwin") {
    app.quit();
  }
});
