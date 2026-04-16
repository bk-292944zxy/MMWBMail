require("tsx/cjs");

const { contextBridge, ipcRenderer } = require("electron");
const {
  ELECTRON_MAIL_CHANNELS
} = require("../lib/electron/ipc-contract.ts");

const bridge = {
  version: 2,
  isElectron: true,
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
  printToPdf: (input) => ipcRenderer.invoke(ELECTRON_MAIL_CHANNELS.printToPdf, input)
};

contextBridge.exposeInMainWorld("maximailDesktop", bridge);
