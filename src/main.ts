// Orchestrator-owned entry point.
import { loadConfig } from './shared/config';
import { createApp } from './app';

const config = loadConfig();
const { app } = createApp(config);
if (config.isProduction && !config.cookieSecure) {
  console.warn('Warning: running in production without COOKIE_SECURE=true. Serve the site over HTTPS before going live.');
}
app.listen(config.port, () => {
  console.log(`Saltline API listening on http://localhost:${config.port}`);
});
