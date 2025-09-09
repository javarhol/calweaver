import { onRequestGet as __oauth_google_callback_ts_onRequestGet } from "/Users/jvarhol2/Documents/calweaver/functions/oauth/google/callback.ts"
import { onRequestGet as __oauth_google_start_ts_onRequestGet } from "/Users/jvarhol2/Documents/calweaver/functions/oauth/google/start.ts"
import { onRequestDelete as __api_byok_ts_onRequestDelete } from "/Users/jvarhol2/Documents/calweaver/functions/api/byok.ts"
import { onRequestPost as __api_byok_ts_onRequestPost } from "/Users/jvarhol2/Documents/calweaver/functions/api/byok.ts"
import { onRequestGet as __api_me_ts_onRequestGet } from "/Users/jvarhol2/Documents/calweaver/functions/api/me.ts"
import { onRequestGet as __api_preferences_ts_onRequestGet } from "/Users/jvarhol2/Documents/calweaver/functions/api/preferences.ts"
import { onRequestPost as __api_preferences_ts_onRequestPost } from "/Users/jvarhol2/Documents/calweaver/functions/api/preferences.ts"
import { onRequestPost as __api_run_ts_onRequestPost } from "/Users/jvarhol2/Documents/calweaver/functions/api/run.ts"
import { onRequestGet as __cron_daily_ts_onRequestGet } from "/Users/jvarhol2/Documents/calweaver/functions/cron/daily.ts"

export const routes = [
    {
      routePath: "/oauth/google/callback",
      mountPath: "/oauth/google",
      method: "GET",
      middlewares: [],
      modules: [__oauth_google_callback_ts_onRequestGet],
    },
  {
      routePath: "/oauth/google/start",
      mountPath: "/oauth/google",
      method: "GET",
      middlewares: [],
      modules: [__oauth_google_start_ts_onRequestGet],
    },
  {
      routePath: "/api/byok",
      mountPath: "/api",
      method: "DELETE",
      middlewares: [],
      modules: [__api_byok_ts_onRequestDelete],
    },
  {
      routePath: "/api/byok",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_byok_ts_onRequestPost],
    },
  {
      routePath: "/api/me",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_me_ts_onRequestGet],
    },
  {
      routePath: "/api/preferences",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_preferences_ts_onRequestGet],
    },
  {
      routePath: "/api/preferences",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_preferences_ts_onRequestPost],
    },
  {
      routePath: "/api/run",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_run_ts_onRequestPost],
    },
  {
      routePath: "/cron/daily",
      mountPath: "/cron",
      method: "GET",
      middlewares: [],
      modules: [__cron_daily_ts_onRequestGet],
    },
  ]