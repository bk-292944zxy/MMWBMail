const path = require("node:path");
const process = require("node:process");
const fs = require("node:fs");
const http = require("node:http");
const { spawn } = require("node:child_process");

require("tsx/cjs");
require("dotenv/config");

const { app, BrowserWindow, ipcMain, dialog } = require("electron");

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
  createAccountService,
  listAccountsService,
  verifyAccountService
} = require("../lib/services/account-management-service.ts");
const {
  getAccountMessageDetailService,
  listAccountMessagesService,
  loadAccountFoldersService,
  sendAccountMessageService
} = require("../lib/services/account-mail-service.ts");
const {
  saveComposeDraftService,
  loadComposeDraftService,
  listComposeDraftsService,
  deleteComposeDraftService
} = require("../lib/services/compose-draft-service.ts");
const {
  getServiceErrorMessage,
  getServiceErrorStatus
} = require("../lib/services/service-error.ts");

const isDevelopment = !app.isPackaged;
const startUrl = process.env.ELECTRON_START_URL || "http://localhost:3000";
app.setName("MaxiMail");

let packagedServerProcess = null;

console.error("MAIN startup:", {
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
  console.error("createMainWindow: begin");

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

  console.error("createMainWindow: BrowserWindow created");

  window.once("ready-to-show", () => {
    console.error("window ready-to-show");
    window.show();
    if (process.env.ELECTRON_OPEN_DEVTOOLS === "true") {
      console.error("window opening devtools");
      window.webContents.openDevTools({ mode: "detach" });
    }
  });

  window.on("show", () => {
    console.error("window show");
  });

  window.on("closed", () => {
    console.error("window closed");
  });

  window.on("unresponsive", () => {
    console.error("window unresponsive");
  });

  window.webContents.on("did-start-loading", () => {
    console.error("webContents did-start-loading");
  });

  window.webContents.on("did-stop-loading", () => {
    console.error("webContents did-stop-loading");
  });

  window.webContents.on("did-finish-load", () => {
    console.error("webContents did-finish-load", {
      url: window.webContents.getURL()
    });
  });

  window.webContents.on("did-fail-load", (_event, code, description, validatedURL) => {
    console.error("webContents did-fail-load", {
      code,
      description,
      validatedURL
    });
  });

  window.webContents.on("dom-ready", () => {
    console.error("webContents dom-ready", {
      url: window.webContents.getURL()
    });
  });

  window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    console.error("renderer console-message:", {
      level,
      message,
      line,
      sourceId
    });
  });

  console.error("createMainWindow: loadURL", { startUrl });
  window.loadURL(startUrl);

  if (isDevelopment) {
    window.webContents.on("did-fail-load", (_event, code, description) => {
      console.error("electron: failed to load renderer", { code, description, startUrl });
    });
  }

  return window;
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
  console.error("packaged-server: start", { appEntry, startUrl });

  packagedServerProcess = spawn(process.execPath, [appEntry], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      PORT: "3000"
    },
    stdio: "ignore"
  });

  packagedServerProcess.on("exit", (code, signal) => {
    console.error("packaged-server: exit", { code, signal });
    packagedServerProcess = null;
  });

  packagedServerProcess.on("error", (error) => {
    console.error("packaged-server: spawn-error", {
      message: error?.message ?? String(error)
    });
  });

  return packagedServerProcess;
}

function stopPackagedLocalServer() {
  if (!packagedServerProcess || packagedServerProcess.killed) {
    return;
  }
  console.error("packaged-server: stop");
  packagedServerProcess.kill();
}

function registerIpcHandlers() {
  console.error("registerIpcHandlers: begin");

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

  console.error("registerIpcHandlers: complete");
}

app.whenReady().then(async () => {
  console.error("app.whenReady: begin");
  registerIpcHandlers();

  if (app.isPackaged) {
    startPackagedLocalServer();
    const ready = await waitForLocalServer(startUrl);
    if (!ready) {
      console.error("packaged-server: timeout/failure", { startUrl });
      app.quit();
      return;
    }
    console.error("packaged-server: ready", { startUrl });
  }

  createMainWindow();

  app.on("activate", () => {
    console.error("app activate");
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("before-quit", () => {
  stopPackagedLocalServer();
});

app.on("window-all-closed", () => {
  console.error("window-all-closed");
  if (process.platform !== "darwin") {
    app.quit();
  }
});
