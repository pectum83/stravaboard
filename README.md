# stravaBoard

Private dashboard for analysing the **vertical speed** of your Strava
activities: windowed speed series, pause-excluded ascent/descent means, and a
multilayer map (streets / satellite / 3D) synced with the chart cursor.

```bash
nvm use && corepack enable pnpm
pnpm install && cp .env.example .env   # fill in your Strava (and MapTiler) keys
pnpm dev                               # web on :5173, API on :3001
```

Full documentation lives in [`docs/README.md`](docs/README.md).
For contributors/agents: the codebase reference is [`docs/summary/`](docs/summary/index.md).
