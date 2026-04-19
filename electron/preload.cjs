const { contextBridge, ipcRenderer } = require("electron");
const ELECTRON_MAIL_CHANNELS = {
  listAccounts: "mail:list-accounts",
  verifyAccount: "mail:verify-account",
  createAccount: "mail:create-account",
  loadFolders: "mail:load-folders",
  loadMessages: "mail:load-messages",
  loadMessageDetail: "mail:load-message-detail",
  sendMessage: "mail:send-message",
  createDraft: "mail:create-draft",
  saveDraft: "mail:save-draft",
  loadDraft: "mail:load-draft",
  listDrafts: "mail:list-drafts",
  deleteDraft: "mail:delete-draft",
  printToPdf: "mail:print-to-pdf",
  openComposeWindow: "mail:open-compose-window",
  composeCloseRequested: "mail:compose-close-requested",
  respondComposeCloseRequest: "mail:respond-compose-close-request",
  openColorPicker: "color-picker:open",
  publishColorPickerChange: "color-picker:publish-change",
  publishColorPickerCommit: "color-picker:publish-commit",
  colorPickerOpenRequest: "color-picker:open-request",
  colorPickerChange: "color-picker:change",
  colorPickerCommit: "color-picker:commit"
};
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
    ipcRenderer.invoke(ELECTRON_MAIL_CHANNELS.respondComposeCloseRequest, input),
  openColorPicker: (initialColor) =>
    ipcRenderer.invoke(ELECTRON_MAIL_CHANNELS.openColorPicker, initialColor),
  publishColorPickerChange: (color) =>
    ipcRenderer.invoke(ELECTRON_MAIL_CHANNELS.publishColorPickerChange, color),
  publishColorPickerCommit: (color) =>
    ipcRenderer.invoke(ELECTRON_MAIL_CHANNELS.publishColorPickerCommit, color),
  onColorPickerOpenRequest: (listener) => {
    if (typeof listener !== "function") {
      return () => {};
    }
    const handler = (_event, color) => {
      listener(color);
    };
    ipcRenderer.on(ELECTRON_MAIL_CHANNELS.colorPickerOpenRequest, handler);
    return () => {
      ipcRenderer.removeListener(ELECTRON_MAIL_CHANNELS.colorPickerOpenRequest, handler);
    };
  },
  onColorPickerChange: (listener) => {
    if (typeof listener !== "function") {
      return () => {};
    }
    const handler = (_event, color) => {
      listener(color);
    };
    ipcRenderer.on(ELECTRON_MAIL_CHANNELS.colorPickerChange, handler);
    return () => {
      ipcRenderer.removeListener(ELECTRON_MAIL_CHANNELS.colorPickerChange, handler);
    };
  },
  onColorPickerCommit: (listener) => {
    if (typeof listener !== "function") {
      return () => {};
    }
    const handler = (_event, color) => {
      listener(color);
    };
    ipcRenderer.on(ELECTRON_MAIL_CHANNELS.colorPickerCommit, handler);
    return () => {
      ipcRenderer.removeListener(ELECTRON_MAIL_CHANNELS.colorPickerCommit, handler);
    };
  }
};

contextBridge.exposeInMainWorld("maximailDesktop", bridge);
