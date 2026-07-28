import { writeFile } from 'node:fs/promises';
import type { HarnessFixture } from './fixture';

export async function seedHarness(fixture: HarnessFixture, manifestPath: string): Promise<void> {
  const { prisma } = await import('../../../src/lib/prisma');
  const clientA = fixture.clients[0]!;
  const clientB = fixture.clients[1]!;
  const ref = fixture.contentRef;
  const now = new Date('2026-07-27T12:00:00.000Z');

  await prisma.client.createMany({
    data: [
      { id: clientA.id, name: clientA.name, email: clientA.email, password: 'fictional-password-hash' },
      { id: clientB.id, name: clientB.name, email: clientB.email, password: 'fictional-password-hash' },
    ],
  });

  await prisma.content.createMany({
    data: [
      { id: 'example-content-a', clientId: clientA.id, contentRef: ref, title: 'Fictional A content', description: 'Synthetic fixture only', videoUrl: 'fixture/a.mp4', platforms: '["tiktok"]', status: 'published' },
      { id: 'example-content-b', clientId: clientB.id, contentRef: ref, title: 'Fictional B content', description: 'Synthetic fixture only', videoUrl: 'fixture/b.mp4', platforms: '["tiktok"]', status: 'published' },
    ],
  });

  await prisma.accountBinding.createMany({
    data: [
      { id: 'example-binding-a', clientId: clientA.id, platform: 'tiktok', accountUsername: 'fixture-a', collectionStatus: 'success', lastCollectionAttemptAt: new Date('2026-07-22T03:00:00.000Z'), lastCollectionSuccessAt: new Date('2026-07-22T03:01:00.000Z') },
      { id: 'example-binding-b', clientId: clientB.id, platform: 'tiktok', accountUsername: 'fixture-b', collectionStatus: 'success', reauthorizationRequired: true, lastCollectionAttemptAt: new Date('2026-07-22T04:00:00.000Z'), lastCollectionSuccessAt: new Date('2026-07-22T04:01:00.000Z') },
    ],
  });

  await prisma.publishJob.createMany({
    data: [
      { id: 'example-job-a', contentId: 'example-content-a', accountBindingId: 'example-binding-a', platform: 'tiktok', status: 'published' },
      { id: 'example-job-b', contentId: 'example-content-b', accountBindingId: 'example-binding-b', platform: 'tiktok', status: 'published' },
    ],
  });

  await prisma.publishedPost.createMany({
    data: [
      { id: 'example-post-a1', publishJobId: 'example-job-a', accountBindingId: 'example-binding-a', platform: 'tiktok', platformPostId: 'fixture-a-post-1', platformPostUrl: 'https://fixture.invalid/a/1', publishedAt: new Date('2026-07-20T00:00:00.000Z') },
      { id: 'example-post-a2', publishJobId: 'example-job-a', accountBindingId: 'example-binding-a', platform: 'tiktok', platformPostId: 'fixture-a-post-2', platformPostUrl: 'https://fixture.invalid/a/2', publishedAt: new Date('2026-07-20T00:01:00.000Z') },
      { id: 'example-post-b1', publishJobId: 'example-job-b', accountBindingId: 'example-binding-b', platform: 'tiktok', platformPostId: 'fixture-b-post-1', platformPostUrl: 'https://fixture.invalid/b/1', publishedAt: new Date('2026-07-20T00:02:00.000Z') },
      { id: 'example-post-b2', publishJobId: 'example-job-b', accountBindingId: 'example-binding-b', platform: 'tiktok', platformPostId: 'fixture-b-post-2', platformPostUrl: 'https://fixture.invalid/b/2', publishedAt: new Date('2026-07-20T00:03:00.000Z') },
    ],
  });

  await prisma.performanceMetrics.createMany({
    data: [
      { id: 'metric-a1-old', clientId: clientA.id, contentId: 'example-content-a', publishJobId: 'example-job-a', publishedPostId: 'example-post-a1', platform: 'tiktok', platformPostId: 'fixture-a-post-1', metricDate: '2026-07-20-a1', views: 5, likes: 1, comments: 1, shares: 0, observedAt: new Date('2026-07-20T01:00:00.000Z'), collectedAt: new Date('2026-07-20T02:00:00.000Z') },
      { id: 'metric-a1-new', clientId: clientA.id, contentId: 'example-content-a', publishJobId: 'example-job-a', publishedPostId: 'example-post-a1', platform: 'tiktok', platformPostId: 'fixture-a-post-1', metricDate: '2026-07-22-a1', views: 0, likes: null, comments: 7, shares: null, saves: null, reach: null, impressions: null, observedAt: new Date('2026-07-22T01:00:00.000Z'), collectedAt: new Date('2026-07-22T02:00:00.000Z'), rawResponseHash: 'fixture-hash-a1' },
      { id: 'metric-a2-old', clientId: clientA.id, contentId: 'example-content-a', publishJobId: 'example-job-a', publishedPostId: 'example-post-a2', platform: 'tiktok', platformPostId: 'fixture-a-post-2', metricDate: '2026-07-20-a2', views: 200, likes: 10, comments: 2, shares: 1, observedAt: new Date('2026-07-20T03:00:00.000Z'), collectedAt: new Date('2026-07-20T04:00:00.000Z') },
      { id: 'metric-a2-new', clientId: clientA.id, contentId: 'example-content-a', publishJobId: 'example-job-a', publishedPostId: 'example-post-a2', platform: 'tiktok', platformPostId: 'fixture-a-post-2', metricDate: '2026-07-22-a2', views: 300, likes: 30, comments: 3, shares: 2, saves: null, reach: null, impressions: null, observedAt: new Date('2026-07-22T03:00:00.000Z'), collectedAt: new Date('2026-07-22T04:00:00.000Z') },
      { id: 'metric-b1-old', clientId: clientB.id, contentId: 'example-content-b', publishJobId: 'example-job-b', publishedPostId: 'example-post-b1', platform: 'tiktok', platformPostId: 'fixture-b-post-1', metricDate: '2026-07-20-b1', views: 800, likes: 80, comments: 8, shares: 3, observedAt: new Date('2026-07-20T05:00:00.000Z'), collectedAt: new Date('2026-07-20T06:00:00.000Z') },
      { id: 'metric-b1-new', clientId: clientB.id, contentId: 'example-content-b', publishJobId: 'example-job-b', publishedPostId: 'example-post-b1', platform: 'tiktok', platformPostId: 'fixture-b-post-1', metricDate: '2026-07-22-b1', views: 900, likes: 90, comments: 9, shares: 4, observedAt: new Date('2026-07-22T05:00:00.000Z'), collectedAt: new Date('2026-07-22T06:00:00.000Z') },
      { id: 'metric-b2-old', clientId: clientB.id, contentId: 'example-content-b', publishJobId: 'example-job-b', publishedPostId: 'example-post-b2', platform: 'tiktok', platformPostId: 'fixture-b-post-2', metricDate: '2026-07-20-b2', views: 10, likes: 1, comments: 0, shares: 0, observedAt: new Date('2026-07-20T07:00:00.000Z'), collectedAt: new Date('2026-07-20T08:00:00.000Z') },
      { id: 'metric-b2-new', clientId: clientB.id, contentId: 'example-content-b', publishJobId: 'example-job-b', publishedPostId: 'example-post-b2', platform: 'tiktok', platformPostId: 'fixture-b-post-2', metricDate: '2026-07-22-b2', views: 20, likes: 2, comments: 1, shares: 0, observedAt: new Date('2026-07-22T07:00:00.000Z'), collectedAt: new Date('2026-07-22T08:00:00.000Z') },
    ],
  });

  await writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, seededAt: now.toISOString(), clients: fixture.clients.map(({ id }) => id), contentRef: ref, synthetic: true }, null, 2) + '\n', { mode: 0o600 });
}
