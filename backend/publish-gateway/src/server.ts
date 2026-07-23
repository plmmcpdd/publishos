import 'dotenv/config';
import cron from 'node-cron';
import { createApp } from './app';
import { initializeSecurityConfig } from './config/security';
import { collectAllMetrics } from './services/metrics-collector';

initializeSecurityConfig();
const app = createApp();
const port = Number(process.env.PORT || 3000);

cron.schedule('0 2 * * *', async () => {
  try { await collectAllMetrics(); } catch { console.error('Daily metrics collection failed'); }
});

app.listen(port, () => console.log(`Publish Gateway listening on port ${port}`));
