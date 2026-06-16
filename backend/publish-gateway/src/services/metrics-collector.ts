import { prisma } from '../lib/prisma';
import { collectFacebookMetrics } from './collectors/facebook-collector';
import { collectInstagramMetrics } from './collectors/instagram-collector';
import { collectTikTokMetrics } from './collectors/tiktok-collector';

export async function collectAllMetrics(): Promise<void> {
  console.log('[metrics] Starting daily collection...');

  const bindings = await prisma.accountBinding.findMany({
    where: {
      status: 'active',
      active: true,
      platform: { in: ['tiktok', 'instagram', 'facebook'] },
    },
    select: { id: true, platform: true },
  });

  for (const binding of bindings) {
    try {
      if (binding.platform === 'tiktok') await collectTikTokMetrics(binding.id);
      if (binding.platform === 'instagram') await collectInstagramMetrics(binding.id);
      if (binding.platform === 'facebook') await collectFacebookMetrics(binding.id);
      console.log(`[metrics] Collected for ${binding.platform} binding ${binding.id}`);
    } catch (error) {
      console.error(`[metrics] Error collecting ${binding.platform} binding ${binding.id}:`, error);
    }
  }

  console.log('[metrics] Collection complete.');
}
