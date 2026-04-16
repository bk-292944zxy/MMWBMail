const path = require("node:path");
const process = require("node:process");
const fs = require("node:fs");

require("tsx/cjs");
require("dotenv/config");

const { app, BrowserWindow, ipcMain, dialog } = require("electron");
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

function toIpcError(error, fallbackMessage) {
  const message = getServiceErrorMessage(error, fallbackMessage);
  const status = getServiceErrorStatus(error, 500);
  const ipcError = new Error(message);
  ipcError.name = "ElectronServiceError";
  ipcError.code = String(status);
  return ipcError;
}

function createMainWindow() {
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

  window.once("ready-to-show", () => {
    window.show();
    if (process.env.ELECTRON_OPEN_DEVTOOLS === "true") {
      window.webContents.openDevTools({ mode: "detach" });
    }
  });

  window.loadURL(startUrl);

  if (isDevelopment) {
    window.webContents.on("did-fail-load", (_event, code, description) => {
      console.error("electron: failed to load renderer", { code, description, startUrl });
    });
  }

  return window;
}

function registerIpcHandlers() {
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
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
