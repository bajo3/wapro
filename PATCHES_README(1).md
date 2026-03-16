# Patch v2 — Bot general toggle (ON/OFF)

## Included
### Frontend
- `apps/panel-whaticket/frontend/src/pages/Bot/BotGeneralToggle.js`

### Backend
- `apps/panel-whaticket/backend/src/controllers/BotSettingsController.ts`
- `apps/panel-whaticket/backend/src/routes/botSettingsRoutes.ts`
- Endpoints:
  - `GET /bot/settings`  -> `{ enabled: boolean }`
  - `PUT /bot/settings`  -> `{ enabled: boolean }`

## Manual wiring (required)
### 1) Register the route in your main routes index
Example:

```ts
import botSettingsRoutes from "./botSettingsRoutes";
app.use(botSettingsRoutes);
```

### 2) Make the bot respect the global flag
Wherever your bot decides to answer:

```ts
const botSetting = await Setting.findOne({ where: { key: "BOT_ENABLED" } });
const botEnabled = botSetting ? botSetting.value === "true" : true;
if (!botEnabled) return;
```

### 3) Show the button in your Bot page
Inside your Bot page:

```js
import BotGeneralToggle from "./BotGeneralToggle";
...
<BotGeneralToggle />
```
