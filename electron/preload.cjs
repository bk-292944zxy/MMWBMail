require("tsx/cjs");

const { contextBridge, ipcRenderer } = require("electron");
const {
  ELECTRON_MAIL_CHANNELS
} = require("../lib/electron/ipc-contract.ts");
const isComposeWindow = process.argv.some((arg) =>
  arg === "--maximail-compose-window=1" || arg.startsWith("--maximail-compose-window=1")
);

const bridge = {
  version: 2,
  isElectron: true,
  isComposeWindow,
  listAccounts: () => ipcRenderer.invoke(ELECTRON_MAIL_CHANNELS.listAccounts),
  verifyAccount: (payload) => ipcRenderer.invoke(ELECTRON_MAIL_CHANNELS.verifyAccount, payload),
  createAccount: (payload) => ipcRenderer.invoke(ELECTRON_MAIL_CHANNELS.createAccount, payload),
  loadFolders: (input) => ipcRenderer.invoke(ELECTRON_MAIL_CHANNELS.loadFolders, input),
  loadMessages: (input) => ipcRenderer.invoke(ELECTRON_MAIL_CHANNELS.loadMessages, input),
  loadMessageDetail: (input) =>
    ipcRenderer.invoke(ELECTRON_MAIL_CHANNELS.loadMessageDetail, input),
  sendMessage: (input) => ipcRenderer.invoke(ELECTRON_MAIL_CHANNELS.sendMessage, input),
  createDraft: (input) => ipcRenderer.invoke(ELECTRON_MAIL_CHANNELS.createDraft, input),
  saveDraft: (input) => ipcRenderer.invoke(ELECTRON_MAIL_CHANNELS.saveDraft, input),
  loadDraft: (input) => ipcRenderer.invoke(ELECTRON_MAIL_CHANNELS.loadDraft, input),
  listDrafts: (input) => ipcRenderer.invoke(ELECTRON_MAIL_CHANNELS.listDrafts, input),
  deleteDraft: (input) => ipcRenderer.invoke(ELECTRON_MAIL_CHANNELS.deleteDraft, input),
  printToPdf: (input) => ipcRenderer.invoke(ELECTRON_MAIL_CHANNELS.printToPdf, input),
  openComposeWindow: (input) => ipcRenderer.invoke(ELECTRON_MAIL_CHANNELS.openComposeWindow, input),
  onComposeCloseRequested: (listener) => {
    if (typeof listener !== "function") {
      return () => {};
    }
    const handler = () => {
      listener();
    };
    ipcRenderer.on(ELECTRON_MAIL_CHANNELS.composeCloseRequested, handler);
    return () => {
      ipcRenderer.removeListener(ELECTRON_MAIL_CHANNELS.composeCloseRequested, handler);
    };
  },
  respondComposeCloseRequest: (input) =>
    ipcRenderer.invoke(ELECTRON_MAIL_CHANNELS.respondComposeCloseRequest, input)
};

contextBridge.exposeInMainWorld("maximailDesktop", bridge);
