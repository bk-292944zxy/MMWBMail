const path = require("node:path");
const process = require("node:process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");

require("tsx/cjs");
require("dotenv/config");

const { app, BrowserWindow, ipcMain, dialog, Menu } = require("electron");
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
const allowDevTools =
  isDevelopment || process.env.ELECTRON_ALLOW_DEVTOOLS === "true";
let startUrl = app.isPackaged
  ? "http://127.0.0.1:3000"
  : (process.env.ELECTRON_START_URL || "http://localhost:3000");
const PACKAGED_DB_FILENAME = "maximail.db";
const PACKAGED_DB_SEED_RELATIVE_PATH = path.join("seed", "blank-seed.db");
const BLANK_WINDOW_TITLE = "";
app.setName("MaxiMail");

let packagedServerProcess = null;
let packagedServerPort = null;
let mainWindow = null;
let composeWindow = null;
let appIsQuitting = false;
let appQuitPendingFromCompose = false;
const composeCloseBypassIds = new Set();
const composeClosePromptPendingIds = new Set();
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
    title: BLANK_WINDOW_TITLE,
    movable: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: allowDevTools
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
  window.setTitle(BLANK_WINDOW_TITLE);
  window.on("page-title-updated", (event) => {
    event.preventDefault();
    if (!window.isDestroyed()) {
      window.setTitle(BLANK_WINDOW_TITLE);
    }
  });

  if (isDevelopment) {
    window.webContents.on("did-fail-load", (_event, code, description) => {
      logLine("electron: failed to load renderer", { code, description, startUrl });
    });
  }

  return window;
}

function getActiveWindow() {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) {
    return focused;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow;
  }
  return null;
}

function openRendererSettings(window = getActiveWindow()) {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
    return;
  }

  window.webContents.sendInputEvent({
    type: "keyDown",
    keyCode: ",",
    modifiers: ["meta"]
  });
  window.webContents.sendInputEvent({
    type: "keyUp",
    keyCode: ",",
    modifiers: ["meta"]
  });
}

function buildComposeWindowUrl(options = {}) {
  const composeUrl = new URL(startUrl);
  composeUrl.searchParams.set("compose", "1");
  if (typeof options.draftId === "string" && options.draftId.trim().length > 0) {
    composeUrl.searchParams.set("draftId", options.draftId.trim());
  }
  return composeUrl.toString();
}

function createComposeWindow(options = {}) {
  if (composeWindow && !composeWindow.isDestroyed()) {
    if (typeof options.draftId === "string" && options.draftId.trim().length > 0) {
      const nextUrl = buildComposeWindowUrl({ draftId: options.draftId });
      if (composeWindow.webContents.getURL() !== nextUrl) {
        logLine("createComposeWindow: reload-existing-with-draft", {
          draftId: options.draftId
        });
        composeWindow.loadURL(nextUrl);
      }
    }
    if (composeWindow.isMinimized()) {
      composeWindow.restore();
    }
    composeWindow.focus();
    return composeWindow;
  }

  const window = new BrowserWindow({
    width: 570,
    height: 760,
    minWidth: 500,
    minHeight: 620,
    show: false,
    movable: true,
    autoHideMenuBar: true,
    ...(process.platform === "darwin"
      ? {
          title: BLANK_WINDOW_TITLE
        }
      : {}),
    modal: false,
    backgroundColor: "#f5f2ee",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: allowDevTools,
      additionalArguments: ["--maximail-compose-window=1"]
    }
  });

  const composeUrl = buildComposeWindowUrl(options);
  if (typeof window.setParentWindow === "function") {
    window.setParentWindow(null);
  }
  logLine("createComposeWindow: created", {
    id: window.id,
    parentId: window.getParentWindow()?.id ?? null,
    isModal: typeof window.isModal === "function" ? window.isModal() : false
  });
  logLine("createComposeWindow: loadURL", { composeUrl });
  window.loadURL(composeUrl);
  window.setTitle(BLANK_WINDOW_TITLE);
  window.on("page-title-updated", (event) => {
    event.preventDefault();
    if (!window.isDestroyed()) {
      window.setTitle(BLANK_WINDOW_TITLE);
    }
  });

  window.once("ready-to-show", () => {
    logLine("composeWindow ready-to-show");
    window.show();
    window.focus();
  });

  window.on("close", async (event) => {
    if (composeCloseBypassIds.has(window.id)) {
      composeCloseBypassIds.delete(window.id);
      return;
    }

    event.preventDefault();

    if (composeClosePromptPendingIds.has(window.id)) {
      return;
    }

    const result = await dialog.showMessageBox(window, {
      type: "question",
      buttons: ["Save Draft", "Don't Save", "Cancel"],
      defaultId: 0,
      cancelId: 2,
      message: "Save draft before closing?",
      detail: "You can keep this draft and come back later."
    });

    if (window.isDestroyed()) {
      return;
    }

    if (result.response === 2) {
      if (appQuitPendingFromCompose) {
        appQuitPendingFromCompose = false;
        appIsQuitting = false;
      }
      return;
    }

    if (result.response === 1) {
      composeCloseBypassIds.add(window.id);
      window.close();
      return;
    }

    composeClosePromptPendingIds.add(window.id);
    logLine("composeWindow close requested", { id: window.id });
    if (!window.webContents.isDestroyed()) {
      window.webContents.send(ELECTRON_MAIL_CHANNELS.composeCloseRequested);
      return;
    }

    composeClosePromptPendingIds.delete(window.id);
  });

  window.on("closed", () => {
    logLine("composeWindow closed");
    composeCloseBypassIds.delete(window.id);
    composeClosePromptPendingIds.delete(window.id);
    composeWindow = null;
    if (appQuitPendingFromCompose) {
      appQuitPendingFromCompose = false;
      app.quit();
    }
  });

  composeWindow = window;
  return window;
}

function configureApplicationMenu() {
  if (process.platform !== "darwin") {
    return;
  }

  const viewMenu = allowDevTools
    ? { role: "viewMenu" }
    : {
        label: "View",
        submenu: [
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { type: "separator" },
          { role: "togglefullscreen" }
        ]
      };

  const template = [
    {
      label: "MaxiMail",
      submenu: [
        {
          label: "Settings…",
          accelerator: "CmdOrCtrl+,",
          click: () => openRendererSettings()
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    {
      label: "File",
      submenu: [
        {
          label: "New Message",
          accelerator: "CmdOrCtrl+N",
          click: () => {
            createComposeWindow();
          }
        },
        { type: "separator" },
        { role: "close" }
      ]
    },
    { role: "editMenu" },
    viewMenu,
    { role: "windowMenu" }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
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

function configurePackagedMailAccountSecret() {
  if (!app.isPackaged) {
    return null;
  }

  if (process.env.MAIL_ACCOUNT_SECRET?.trim()) {
    logLine("packaged-mail-secret: using-env");
    return process.env.MAIL_ACCOUNT_SECRET;
  }

  const userDataPath = app.getPath("userData");
  const secretDir = path.join(userDataPath, ".maximail-secrets");
  const secretPath = path.join(secretDir, "mail-account-secret.txt");

  fs.mkdirSync(secretDir, { recursive: true });

  let secret = "";
  if (fs.existsSync(secretPath)) {
    secret = fs.readFileSync(secretPath, "utf8").trim();
  }

  if (!secret) {
    secret = crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(secretPath, `${secret}\n`, { mode: 0o600 });
    logLine("packaged-mail-secret: generated", { secretPath });
  } else {
    logLine("packaged-mail-secret: loaded", { secretPath });
  }

  process.env.MAIL_ACCOUNT_SECRET = secret;
  return secret;
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

function reserveLocalPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", (error) => reject(error));
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string" || typeof address.port !== "number") {
        server.close(() => reject(new Error("Unable to resolve local server port.")));
        return;
      }
      const { port } = address;
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function ensurePackagedServerPort() {
  if (!app.isPackaged) {
    return null;
  }
  if (packagedServerPort) {
    return packagedServerPort;
  }

  const port = await reserveLocalPort();
  packagedServerPort = port;
  startUrl = `http://127.0.0.1:${port}`;
  logLine("packaged-server: reserved-port", { port, startUrl });
  return port;
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
  const port = packagedServerPort || 3000;
  logLine("packaged-server: start", { appEntry, startUrl, cwd, port });

  packagedServerProcess = spawn(process.execPath, [appEntry], {
    cwd,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      PORT: String(port)
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

  ipcMain.handle(ELECTRON_MAIL_CHANNELS.openComposeWindow, async (_event, input) => {
    try {
      createComposeWindow({
        draftId:
          input && typeof input === "object" && typeof input.draftId === "string"
            ? input.draftId
            : null
      });
      return { opened: true };
    } catch (error) {
      throw toIpcError(error, "Unable to open compose window.");
    }
  });

  ipcMain.handle(ELECTRON_MAIL_CHANNELS.respondComposeCloseRequest, async (event, input) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow || senderWindow.isDestroyed()) {
      return { closed: false };
    }

    const decision = input?.decision;
    composeClosePromptPendingIds.delete(senderWindow.id);
    if (decision === "save" || decision === "discard") {
      composeCloseBypassIds.add(senderWindow.id);
      senderWindow.close();
      return { closed: true };
    }

    return { closed: false };
  });

  ipcMain.handle(ELECTRON_MAIL_CHANNELS.openColorPicker, async (event, initialColor) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow || senderWindow.isDestroyed()) {
      return { opened: false };
    }
    const color =
      typeof initialColor === "string" && initialColor.trim().length > 0
        ? initialColor.trim()
        : "#0a84ff";
    senderWindow.webContents.send(ELECTRON_MAIL_CHANNELS.colorPickerOpenRequest, color);
    return { opened: true };
  });

  ipcMain.handle(ELECTRON_MAIL_CHANNELS.publishColorPickerChange, async (event, color) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow || senderWindow.isDestroyed()) {
      return { delivered: false };
    }
    if (typeof color !== "string" || color.trim().length === 0) {
      return { delivered: false };
    }
    senderWindow.webContents.send(ELECTRON_MAIL_CHANNELS.colorPickerChange, color.trim());
    return { delivered: true };
  });

  ipcMain.handle(ELECTRON_MAIL_CHANNELS.publishColorPickerCommit, async (event, color) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow || senderWindow.isDestroyed()) {
      return { delivered: false };
    }
    if (typeof color !== "string" || color.trim().length === 0) {
      return { delivered: false };
    }
    senderWindow.webContents.send(ELECTRON_MAIL_CHANNELS.colorPickerCommit, color.trim());
    return { delivered: true };
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
    configurePackagedMailAccountSecret();
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
    await ensurePackagedServerPort();
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

  mainWindow = createMainWindow();
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  configureApplicationMenu();

  app.on("activate", () => {
    logLine("app activate");
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
      mainWindow.on("closed", () => {
        mainWindow = null;
      });
      configureApplicationMenu();
    }
  });
});

app.on("before-quit", (event) => {
  if (
    composeWindow &&
    !composeWindow.isDestroyed() &&
    !composeCloseBypassIds.has(composeWindow.id)
  ) {
    event.preventDefault();
    appQuitPendingFromCompose = true;
    if (!composeClosePromptPendingIds.has(composeWindow.id)) {
      composeWindow.focus();
      composeWindow.close();
    }
    return;
  }

  appIsQuitting = true;
  stopPackagedLocalServer();
});

app.on("window-all-closed", () => {
  logLine("window-all-closed");
  if (process.platform !== "darwin") {
    app.quit();
  }
});
