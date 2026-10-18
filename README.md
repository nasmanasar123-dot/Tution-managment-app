# Tuition Manager

A simple, mobile-friendly app for a tuition center that does two things: it collects and tracks fees, and it tracks attendance.

- **Stack:** Node.js + Express, SQLite (better-sqlite3), EJS pages, plain CSS. No build step.
- **Classes:** 8, 9 and 10, each with divisions A to D (12 batches) are created on first run. Each batch's monthly fee starts at ₹2,500 and can be changed in Settings.

## Features

- **Dashboard:** shows money collected today and this month (against this month's fees), total pending, a 6-month collection chart, class-wise progress, the payment-method split, top pending students, recent payments and today's attendance.
- **Quick Collect:** use the ₹ button, which is on every screen. Search for a student, and the amount is pre-filled with what's pending. Choose Cash, UPI, Bank or Cheque and save. You get a receipt screen with a **PDF download** and **Send on WhatsApp**.
- **Student profile:** shows pending amount, all payment receipts (each downloadable as a PDF), month-by-month fee status (Paid, Partial, Due or Waived), attendance %, and a WhatsApp fee reminder.
- **Attendance:** pick a class, and everyone starts as present. Tap the absentees and save.
- **Reports:** collections by date range, class and method; pending fees; monthly attendance %. Every report exports to CSV.
- **Results & Toppers:** enter marks per exam, division and subject (AB for absent). The analysis shows school toppers and toppers by class, division and subject; subject and division averages; grade distribution (CBSE-style A1–E); the most improved students since the previous exam; students who need attention; and attendance vs marks. Each student's profile shows their exam history with class and division rank. Exams, subjects and the pass mark are editable in Settings.

## Demo with sample data

```bash
npm run demo              # local demo copy with 50 sample students: http://localhost:3001 (demo / demo1234)
npm run demo -- --reset   # regenerate the sample data
```

The demo uses its own database (`data/demo/`) and never touches real data.

## How fees work

- Each active student is charged their batch's monthly fee for every month from **"Charge fees from"** up to the current month. New months are added automatically.
- Payments are applied to the **oldest unpaid month first**. Partial payments and advance payments both work. Pending = total charged − total paid.
- **Waive** a month from the student's profile (for a holiday, illness and so on).
- **Mark as left** stops future charges. Re-activating resumes charges from the current month, and the months away are waived.
- If you entered a payment by mistake, **cancel the receipt**. It stays on record as cancelled and the amount goes back to pending. Receipt numbers are never reused.
- Changing a batch fee applies from next month by default. You can choose to apply it to this month instead. Months already charged keep their old amount.

## Run locally

```bash
npm install
npm run create-admin      # choose a username + password
npm run seed              # optional: demo data (only into an empty database)
npm start                 # http://localhost:3000
```

Data lives in `data/tuition.db`. Set `DATA_DIR` to keep it somewhere else.

## Deploy on Ubuntu VPS

```bash
# 1. Node.js 22 LTS + nginx + build tools (for better-sqlite3)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs nginx build-essential python3

# 2. App user and code
sudo useradd --system --create-home --home-dir /opt/tuition tuition
sudo cp -r . /opt/tuition    # or git clone into /opt/tuition (without node_modules/data)
sudo chown -R tuition:tuition /opt/tuition
cd /opt/tuition
sudo -u tuition npm ci --omit=dev
sudo -u tuition npm run create-admin

# 3. Service
sudo cp deploy/tuition.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now tuition
sudo systemctl status tuition

# 4. nginx + HTTPS (edit the domain in the file first)
sudo cp deploy/nginx.conf /etc/nginx/sites-available/tuition
sudo ln -s /etc/nginx/sites-available/tuition /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d fees.example.com
```

> In production the login cookie is HTTPS-only. Until certbot is done, uncomment `INSECURE_COOKIE=1` in the service file, or you won't be able to log in.

### Daily backups

```bash
sudo -u tuition crontab -e
# add (runs 11pm daily, keeps the last 30 copies in /opt/tuition/data/backups):
0 23 * * * cd /opt/tuition && /usr/bin/node scripts/backup.js >> data/backup.log 2>&1
```

Also copy `data/backups/` off the server now and then, for example with `rsync` to your laptop or Google Drive. If the VPS dies, those copies are your only record of fees.

To **restore**, stop the service, replace `data/tuition.db` with a backup file (and delete any `tuition.db-wal` and `tuition.db-shm`), then start the service.

### Updating the app

```bash
cd /opt/tuition && sudo -u tuition git pull && sudo -u tuition npm ci --omit=dev && sudo systemctl restart tuition
```

### Forgot password

```bash
cd /opt/tuition && sudo -u tuition node scripts/create-admin.js admin NewPassword123
```
