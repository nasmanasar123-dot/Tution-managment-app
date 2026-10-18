# Tuition Manager

Fee collection and attendance app for a tuition center (classes 8–10, divisions A–D).
Node.js + Express 5, SQLite via better-sqlite3, EJS views, plain CSS/JS (no build step). See README.md for features and the fee model.

- Entry point: `server.js`. Routes in `routes/`, fee logic in `lib/fees.js`, PDF receipts in `lib/receipt.js`.
- Config via env: `PORT`, `HOST` (default 127.0.0.1), `DB_PATH` (default `data/tuition.db`), `NODE_ENV`, `SESSION_SECRET` (else generated into the DB folder), `TZ` (default Asia/Kolkata).
- Admin login is created with `scripts/create-admin.js`, not through the UI.

## Deployment

Shared course server. Other students' apps run here too.

| | |
|---|---|
| Server | 187.127.162.81 (Ubuntu 26.04) |
| SSH | `ssh nasmanasar123@187.127.162.81` (key login) |
| App name | `tuition` |
| Port | 3600 (allowed range 3600–3699) |
| Address | https://nasmanasar123.dhilber.in → 127.0.0.1:3600 |
| Repo | https://github.com/nasmanasar123-dot/Tution-managment-app (public) |
| Code | `~/apps/tuition/` |
| Database | `~/data/tuition/tuition.db` |
| Backups | `~/data/tuition/backups/` (cron at 21:18 UTC daily, kept 14 days) |
| Settings/secrets | `~/.config/tuition.env` (chmod 600, never commit) |
| Service | `~/.config/systemd/user/tuition.service` (`systemctl --user`) |

### Update steps

After pushing to GitHub:

```
ssh nasmanasar123@187.127.162.81 "cd ~/apps/tuition && git pull && npm ci && systemctl --user restart tuition"
```

Then check `systemctl --user status tuition --no-pager` and open the address.
Logs: `journalctl --user -u tuition -n 50 --no-pager`.

Create or reset the admin login (interactive, run by the user):

```
ssh -t nasmanasar123@187.127.162.81 "cd ~/apps/tuition && node --env-file=$HOME/.config/tuition.env scripts/create-admin.js"
```

### Server rules

1. No `sudo`, `apt` or `npm install -g`. If root is needed, ask the instructor.
2. Stay inside `/home/nasmanasar123`. Never touch anything you didn't create.
3. Listen on 127.0.0.1 only, on a port in 3600–3699 (including test runs).
4. Don't touch the web server, firewall or DNS.
5. Secrets only in `~/.config/tuition.env`, never in git or this file.
6. Keep the app running with `systemctl --user`, not pm2/nohup/screen/`&`.
