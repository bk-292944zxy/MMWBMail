# MMWB Mail

A Next.js email webclient that connects to live IMAP and SMTP accounts, lets you browse and manage messages, and sorts inbox results quickly by sender, subject, or date.

## Features

- Connect to live mail accounts with user-provided IMAP and SMTP settings
- Fetch folders and inbox messages directly from the server
- Sort messages instantly by `date`, `from`, or `subject`
- Search across sender, subject, and preview text
- Open message content, mark read or unread, delete messages, and compose outbound mail
- Persist connection details in browser session storage for local convenience

## Run locally

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

## Notes

- This project expects providers that expose IMAP for mailbox access and SMTP for sending.
- Many providers require an app password instead of your normal account password.
- Message deletion falls back to expunge if a provider-specific trash folder is unavailable.
