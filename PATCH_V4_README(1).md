# Patch v4 — Fix Bot general toggle (404 /bot/settings)

## Problem
Frontend was calling `/bot/settings` which returns 404 in your backend.

## Fix
This patch updates the Bot general toggle to reuse existing endpoints:
- GET  `/bot/intelligence/settings`
- PUT  `/bot/intelligence/settings`

It stores the flag in `settings.botEnabled`.

## How to use
1) Copy `apps/panel-whaticket/frontend/src/pages/Bot/BotGeneralToggle.js` into your project.
2) In your Bot page, import and render:
```js
import BotGeneralToggle from "./BotGeneralToggle";
...
<BotGeneralToggle />
```

## About 403
403 on `/whatsapp`, `/users/:id`, etc. in your console is **session expired** (JWT expired).
Log out and log in again. Optionally we can add an axios interceptor to auto-logout on 401/403.
