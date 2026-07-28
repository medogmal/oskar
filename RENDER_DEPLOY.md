# Render Deploy Guide

Use this setup to run the Vercel/Netlify frontend against hosted backend services.

## Service 1: Python AI

Create a new Render Web Service.

```text
Name: oskar-ai
Language: Python 3
Root Directory: backend/python_analytics
Build Command: pip install -r requirements.txt
Start Command: python -m uvicorn app.main:app --host 0.0.0.0 --port $PORT
Health Check Path: /health
Instance Type: Free
```

Environment variables:

```env
ENABLE_MOCK_LLM=true
OPENAI_API_KEY=YOUR_ROTATED_API_KEY_HERE
OPENAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
OPENAI_MODEL=gemini-2.0-flash
```

After deployment, copy the public URL, for example:

```text
https://oskar-ai.onrender.com
```

## Service 2: Node Backend API

Create a second Render Web Service.

```text
Name: oskar-api
Language: Node
Root Directory: backend
Build Command: npm install --no-audit --no-fund && npm run build
Start Command: npm start
Health Check Path: /
Instance Type: Free
```

Environment variables:

```env
PORT=10000
PYTHON_ANALYTICS_URL=https://oskar-ai.onrender.com
PYTHON_ANALYTICS_TIMEOUT_MS=120000
JWT_SECRET=replace_with_a_long_random_secret
ENABLE_LOCAL_AUTH_FALLBACK=true
```

For full database-backed testing, add PostgreSQL variables and set:

```env
ENABLE_LOCAL_AUTH_FALLBACK=false
PGHOST=your_postgres_host
PGPORT=5432
PGUSER=your_postgres_user
PGPASSWORD=your_postgres_password
PGDATABASE=your_postgres_database
```

## Frontend environment variable

In Vercel or Netlify, set:

```env
VITE_API_BASE_URL=https://oskar-api.onrender.com/api
```

Then redeploy the frontend.

## Quick checks

```text
https://oskar-ai.onrender.com/health
https://oskar-api.onrender.com/
https://oskar-api.onrender.com/api/analytics/health
```
