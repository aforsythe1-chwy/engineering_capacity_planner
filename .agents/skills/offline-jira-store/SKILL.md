---
name: offline-jira-store
description: Safely capture, verify, review, and use the encrypted offline Jira replay store.
---

# Offline Jira Store

Follow the root README's **Encrypted offline Jira store** section. Run `nvm use`
from the repository root before every npm command. Never put a password in an
argument, environment file committed to Git, or a chat, PR, or commit.

Use the checked-in `jira-store:*` commands only. They use the built-in 1Password
reference by default; use `--password-op-ref` only to override it and
`--password-file` as a fallback. Before staging, verify the
output ends in `.jira-store.enc`, check `git status --ignored`, and stage the
exact ciphertext path with `git add -- path`. Do not use broad staging commands.
