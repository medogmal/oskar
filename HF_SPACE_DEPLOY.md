# Hugging Face Space Deploy

This repo includes a root `Dockerfile` for deploying the backend and Python AI together as one Hugging Face Docker Space.

## Important limitation

Hugging Face Docker Spaces run compute. Check your account before relying on this as a no-card solution because Hugging Face documentation currently distinguishes Static Spaces as free for everyone, while compute Spaces such as Docker may require a paid plan.

## Create the Space

1. Open Hugging Face.
2. Create a new Space.
3. Choose:

```text
SDK: Docker
Visibility: Public
Hardware: CPU Basic
```

4. Push this repository to the Space repository:

```powershell
git remote add hf https://huggingface.co/spaces/YOUR_USERNAME/YOUR_SPACE_NAME
git push hf main
```

If `hf` already exists:

```powershell
git remote set-url hf https://huggingface.co/spaces/YOUR_USERNAME/YOUR_SPACE_NAME
git push hf main
```

## Space environment variables

Add these in the Space settings:

```env
PORT=7860
PYTHON_ANALYTICS_PORT=8001
PYTHON_ANALYTICS_URL=http://127.0.0.1:8001
PYTHON_ANALYTICS_TIMEOUT_MS=120000
ENABLE_LOCAL_AUTH_FALLBACK=true
ENABLE_MOCK_LLM=true
JWT_SECRET=replace_with_a_long_random_secret
```

For a real LLM key:

```env
ENABLE_MOCK_LLM=false
OPENAI_API_KEY=your_key
OPENAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
OPENAI_MODEL=gemini-2.0-flash
```

## Vercel frontend variable

After the Space is running, set this in Vercel:

```env
VITE_API_BASE_URL=https://YOUR_USERNAME-YOUR_SPACE_NAME.hf.space/api
```

Then redeploy the frontend.

## Health checks

```text
https://YOUR_USERNAME-YOUR_SPACE_NAME.hf.space/
https://YOUR_USERNAME-YOUR_SPACE_NAME.hf.space/api/analytics/health
https://YOUR_USERNAME-YOUR_SPACE_NAME.hf.space/api/auth/subscription-plans
```
