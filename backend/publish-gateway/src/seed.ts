import { prisma } from './lib/prisma';

const mockTitles = [
  'HVAC Summer Tips',
  'AC Maintenance Guide',
  'Duct Cleaning Demo',
];

function thumbnail(background: string, label: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="96" viewBox="0 0 72 96"><rect width="72" height="96" rx="8" fill="${background}"/><text x="36" y="52" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" font-weight="700" fill="#ffffff">${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

async function seed() {
  let client = await prisma.client.findFirst({
    where: { name: 'PublishOS Demo Client' },
  });

  if (!client) {
    client = await prisma.client.create({
      data: {
        name: 'PublishOS Demo Client',
        industry: 'home services',
      },
    });
  }

  await prisma.content.deleteMany({
    where: { title: { in: mockTitles } },
  });

  await prisma.content.createMany({
    data: [
      {
        clientId: client.id,
        title: 'HVAC Summer Tips',
        description: 'Five quick summer energy tips for HVAC customers.',
        hashtags: JSON.stringify(['hvac', 'summer', 'energysaving']),
        videoUrl: 'mock/hvac-summer-tips.mp4',
        thumbnailUrl: thumbnail('#ff6b35', 'HVAC'),
        platforms: JSON.stringify(['tiktok']),
        status: 'pending_review',
      },
      {
        clientId: client.id,
        title: 'AC Maintenance Guide',
        description: 'A short checklist for seasonal AC maintenance.',
        hashtags: JSON.stringify(['ac', 'maintenance']),
        videoUrl: 'mock/ac-maintenance-guide.mp4',
        thumbnailUrl: thumbnail('#004e89', 'AC'),
        platforms: JSON.stringify(['tiktok']),
        status: 'published',
      },
      {
        clientId: client.id,
        title: 'Duct Cleaning Demo',
        description: 'A quick duct cleaning demo clip.',
        hashtags: JSON.stringify(['ductcleaning', 'demo']),
        videoUrl: 'mock/duct-cleaning-demo.mp4',
        thumbnailUrl: thumbnail('#d32f2f', 'FAIL'),
        platforms: JSON.stringify(['tiktok']),
        status: 'failed',
      },
    ],
  });

  console.log('Mock data seeded');
}

seed()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
