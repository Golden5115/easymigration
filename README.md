# Speedotrack Bulk Provisioner

A web dashboard and automation tool built specifically for **Speedotrack GPS Platform** to bulk-register users, add GPS tracker objects, and automatically assign devices to client accounts.

---

## Supported Authentication Modes

1. **🏢 Dealer CPanel Mode (Recommended for Dealer-SM accounts like `cartrack`)**:
   - Uses your standard CPanel Dealer username (`cartrack`) and password.
   - Operates directly through the CPanel dealer endpoints (`fn_cpanel.users.php` and `fn_cpanel.objects.php`).
   - **Bypasses the "Bulk IMEI Upload: No" restriction**, allowing dealer accounts to bulk provision vehicles and users effortlessly.

2. **🔑 Super Administrator Server API Key Mode**:
   - For root/admin users who have a **Server API Key** from `Super Administrator` &rarr; `Manage Server`.
   - Uses Speedotrack HTTP API 1.9 commands (`api=server`).

---

## Features

- **Automated Provisioning Sequence**:
  1. Detects or registers client user account (with optional login credentials email).
  2. Registers tracker device by 15-digit IMEI, name, and expiration dates.
  3. Automatically links tracker device to client account.
- **Excel Scientific Notation Guard**:
  - Automatically flags if Microsoft Excel truncated 15-digit IMEIs into scientific notation (e.g. `359E14`).
  - Protects your GPS server from corrupted device identifiers.
- **Smart Pacing (Rate-Limit Guard)**: Configurable throttle (150ms - 1000ms) between calls.
- **Visual Live Progress & Terminal**: Real-time progress bar, success/fail counters, and terminal logs.
- **Error Recovery**: One-click **"Retry Failed Rows"** to resume unfinished rows.
- **Export Reports**: Download full execution results or failed-only CSV reports.
- **Dual Mode**: Interactive Web GUI (`http://localhost:3000`) + Headless CLI tool (`cli-import.js`).

---

## Quick Start (Web Dashboard)

### Method 1: Double-click `start.bat` (Windows)
Double-click `start.bat` in this folder. It will start the local server and launch `http://localhost:3000` in your browser.

### Method 2: Command Line
```bash
npm start
```
Then open [http://localhost:3000](http://localhost:3000) in your browser.

---

## CSV File Format

Your CSV should have the following headers:

```csv
email,send_credentials,imei,object_name,expire,expire_date
client@company.com,true,868204051234567,Toyota Hilux - Lagos,false,2028-12-31
client@company.com,false,868204051234568,Ford Ranger - Abuja,false,2028-12-31
driver2@company.com,true,868204059876543,Delivery Van 01,false,2028-12-31
```

> **Important**: When opening or saving CSV files in Microsoft Excel, ensure the `imei` column is formatted as **Text** so Excel does not convert 15-digit numbers into scientific notation (e.g. `3.59E+14`).

---

## Headless CLI Tool

### Dealer CPanel Mode:
```bash
node cli-import.js --file ./public/sample-template.csv --server https://server.cartracker.com.ng/ --username cartrack --password YOUR_PASSWORD --delay 250
```

### Super Admin API Key Mode:
```bash
node cli-import.js --file ./public/sample-template.csv --server https://server.cartracker.com.ng/ --key YOUR_SERVER_KEY --delay 250
```
