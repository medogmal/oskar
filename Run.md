# ClinResearch AI - Local Run Commands

Run each service in a separate PowerShell terminal.

## 1. Python AI service

```powershell
cd D:\Mostaql\oskar\backend
python -m uvicorn app.main:app --app-dir python_analytics --host 127.0.0.1 --port 8001
```

Health check:

```powershell
Invoke-RestMethod http://127.0.0.1:8001/health
```

If port `8001` is already in use, either keep the existing server running or stop it:

```powershell
Get-NetTCPConnection -LocalPort 8001 -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique |
  ForEach-Object { Stop-Process -Id $_ -Force }
```

## 2. Node backend API

```powershell
cd D:\Mostaql\oskar\backend
pnpm dev
```

Health check:

```powershell
Invoke-RestMethod http://127.0.0.1:5000/
```

If `pnpm dev` fails, run the server directly:

```powershell
cd D:\Mostaql\oskar\backend
node node_modules/tsx/dist/cli.mjs src/server.ts
```

## 3. React frontend

```powershell
cd D:\Mostaql\oskar\clinical-research-platform
pnpm dev
```

Open:

```text
http://localhost:5173
```

If port `5173` is already in use and `http://localhost:5173` opens, the frontend is already running. If you want to restart it:

```powershell
Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique |
  ForEach-Object { Stop-Process -Id $_ -Force }
pnpm dev
```

Or run on a different port:

```powershell
pnpm dev -- --host 127.0.0.1 --port 5174
```

## Local database note

For development without PostgreSQL, auth/register/login can use:

```env
ENABLE_LOCAL_AUTH_FALLBACK=true
```

This stores dev accounts in:

```text
backend\data\dev-users.json
```

For production or full study persistence, start PostgreSQL on port `5432`.
