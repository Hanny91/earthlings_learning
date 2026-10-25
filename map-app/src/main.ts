import { config } from './config';

// Placeholder entry point; the map, auth and pin UI are wired in later steps.
const app = document.querySelector<HTMLDivElement>('#app');
if (app) {
  app.textContent = `Survey map scaffold (Data API: ${config.dataApiUrl || 'not configured'})`;
}
