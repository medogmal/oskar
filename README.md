---
title: Oskar Backend AI API
colorFrom: blue
colorTo: green
sdk: docker
app_port: 7860
pinned: false
---

# Oskar Backend AI API

This Docker Space runs the Node backend API on port `7860` and starts the Python analytics service internally on port `8001`.

Frontend deployments should use:

```env
VITE_API_BASE_URL=https://YOUR_USERNAME-YOUR_SPACE_NAME.hf.space/api
```

Useful checks:

```text
/
/api/analytics/health
/api/auth/subscription-plans
```

Development auth fallback is enabled by default for trial deployments without PostgreSQL. Data saved in the container is temporary unless persistent storage is configured.
