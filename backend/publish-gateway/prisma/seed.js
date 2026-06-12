require('dotenv/config');
const { PrismaClient } = require('@prisma/client');
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
const { PrismaPg } = require('@prisma/adapter-pg');
const bcrypt = require('bcryptjs');

const databaseUrl = process.env.DATABASE_URL || 'file:./dev.db';
const adapter = databaseUrl.startsWith('file:')
  ? new PrismaBetterSqlite3({ url: databaseUrl })
  : new PrismaPg({ connectionString: databaseUrl });

const prisma = new PrismaClient({ adapter });

async function main() {
  const password = await bcrypt.hash('password123', 10);

  await prisma.auditLog.deleteMany();
  await prisma.contentAsset.deleteMany();
  await prisma.jobHistory.deleteMany();
  await prisma.publishJob.deleteMany();
  await prisma.content.deleteMany();
  await prisma.accountBinding.deleteMany();
  await prisma.device.deleteMany();
  await prisma.client.deleteMany();

  const c1 = await prisma.client.create({
    data: {
      id: 'demo-client-1',
      name: 'ABC HVAC Services',
      industry: 'HVAC',
      email: 'abc@hvac.com',
      password,
    },
  });
  const c2 = await prisma.client.create({
    data: {
      name: 'CoolBreeze AC Repair',
      industry: 'HVAC',
      email: 'cool@ac.com',
      password,
    },
  });
  const c3 = await prisma.client.create({
    data: {
      name: 'TotalHome Plumbing',
      industry: 'Plumbing',
      email: 'total@plumbing.com',
      password,
    },
  });

  await prisma.content.createMany({
    data: [
      {
        title: 'Spring AC Maintenance Tips',
        description: '3 things every homeowner should do',
        videoUrl: 'mock/spring-ac-maintenance.mp4',
        platforms: JSON.stringify(['tiktok']),
        hashtags: JSON.stringify(['hvac', 'maintenance']),
        status: 'draft',
        clientId: c1.id,
      },
      {
        title: 'Emergency Repair 24/7',
        description: 'When your AC breaks down at 2am',
        videoUrl: 'mock/emergency-repair.mp4',
        platforms: JSON.stringify(['tiktok']),
        hashtags: JSON.stringify(['hvac', 'emergency']),
        status: 'delivered',
        clientId: c1.id,
      },
      {
        title: 'New Customer Special - $50 Off',
        description: 'First time customers get $50 off',
        videoUrl: 'mock/new-customer-special.mp4',
        platforms: JSON.stringify(['instagram']),
        hashtags: JSON.stringify(['deal', 'hvac']),
        status: 'delivered',
        clientId: c2.id,
      },
      {
        title: 'Meet Our Team',
        description: 'The team that keeps your home comfortable',
        videoUrl: 'mock/meet-team.mp4',
        platforms: JSON.stringify(['tiktok']),
        hashtags: JSON.stringify(['team', 'hvac']),
        status: 'published',
        clientId: c2.id,
      },
      {
        title: 'Winter Heating Checklist',
        description: '5 steps to prepare your heating',
        videoUrl: 'mock/winter-heating-checklist.mp4',
        platforms: JSON.stringify(['facebook']),
        hashtags: JSON.stringify(['heating', 'winter']),
        status: 'published',
        clientId: c3.id,
      },
    ],
  });

  console.log('Seed done! Test login: abc@hvac.com / password123');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
}).finally(() => prisma.$disconnect());
