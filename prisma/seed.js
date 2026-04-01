// prisma/seed.js
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding TISUNGA database...');

  const passwordHash = await bcrypt.hash('Password123!', 12);

  // Users
  const michael = await prisma.user.upsert({
    where:  { phone: '+265882752624' },
    update: {},
    create: { phone: '+265882752624', firstName: 'Michael', lastName: 'Enock', passwordHash, isVerified: true, isActive: true },
  });

  const laston = await prisma.user.upsert({
    where:  { phone: '+265997486222' },
    update: {},
    create: { phone: '+265997486222', firstName: 'Laston', lastName: 'Mzumala', passwordHash, isVerified: true, isActive: true },
  });

  const zechael = await prisma.user.upsert({
    where:  { phone: '+265997489899' },
    update: {},
    create: { phone: '+265997489899', firstName: 'Zechael', lastName: 'Chisi', passwordHash, isVerified: true, isActive: true },
  });

  const alinafe = await prisma.user.upsert({
    where:  { phone: '+265998928373' },
    update: {},
    create: { phone: '+265998928373', firstName: 'Alinafe', lastName: 'Zamwe', passwordHash, isVerified: true, isActive: true },
  });

  console.log('✅ Users seeded');

  // Groups 
  const domanGroup = await prisma.group.upsert({
    where:  { groupCode: '467WEISH6' },
    update: {},
    create: {
      name: 'Doman Group', description: 'A community savings group based in Chikanda',
      location: 'Chikanda', groupCode: '467WEISH6',
      minContribution: 2000, savingPeriodMonths: 6, maxMembers: 10,
      visibility: 'PUBLIC', totalSavings: 1000090,
      startDate: new Date('2026-02-01'), endDate: new Date('2027-02-01'),
      meetingDay: 'Friday', meetingTime: '15:00', isActive: true,
    },
  });

  const kaluluGroup = await prisma.group.upsert({
    where:  { groupCode: '2Q12QABCD' },
    update: {},
    create: {
      name: 'Kalulu Group', description: 'Savings group — minimum MK 2,000 weekly',
      location: 'Zomba', groupCode: '2Q12QABCD',
      minContribution: 2000, savingPeriodMonths: 6, maxMembers: 8,
      visibility: 'PUBLIC', totalSavings: 200000,
      startDate: new Date('2026-01-15'), endDate: new Date('2026-07-15'),
      meetingDay: 'Saturday', meetingTime: '10:00', isActive: true,
    },
  });

  console.log('✅ Groups seeded');

  // Memberships
  const upsertMembership = (groupId, userId, role, memberSavings = 0) =>
    prisma.groupMembership.upsert({
      where:  { groupId_userId: { groupId, userId } },
      update: {},
      create: { groupId, userId, role, status: 'ACTIVE', memberSavings },
    });

  await upsertMembership(domanGroup.id, laston.id,   'CHAIR',     102999);
  await upsertMembership(domanGroup.id, zechael.id,  'SECRETARY', 80000);
  await upsertMembership(domanGroup.id, michael.id,  'MEMBER',    102999);
  await upsertMembership(domanGroup.id, alinafe.id,  'MEMBER',    60000);
  await upsertMembership(kaluluGroup.id, michael.id, 'CHAIR',     50000);

  console.log('✅ Memberships seeded');

  // Sample Active Loan (Michael in Doman Group) 
  const existingLoan = await prisma.loan.findFirst({
    where: { borrowerId: michael.id, groupId: domanGroup.id, status: 'ACTIVE' },
  });

  if (!existingLoan) {
    await prisma.loan.create({
      data: {
        transactionRef:  'TISU10001.01',
        borrowerId:      michael.id,
        approverId:      laston.id,
        groupId:         domanGroup.id,
        principalAmount: 650000,
        interestRate:    5,
        totalRepayable:  682500,
        remainingBalance: 350000,
        durationMonths:  9,
        dueDate:         new Date('2026-11-04'),
        approvedAt:      new Date('2026-02-01'),
        disbursedAt:     new Date('2026-02-01'),
        status:          'ACTIVE',
      },
    });
    console.log('✅ Sample loan seeded');
  }

  //  Events 
  await prisma.event.upsert({
    where:  { id: 'seed-event-wedding' },
    update: {},
    create: {
      id: 'seed-event-wedding', groupId: domanGroup.id,
      title: 'Uchiae & Michael Wedding', type: 'WEDDING',
      eventDate: new Date('2045-09-09'), contributionType: 'SAVINGS',
      fixedAmount: 600, raisedSoFar: 12000, status: 'UPCOMING',
    },
  });

  await prisma.event.upsert({
    where:  { id: 'seed-event-birthday' },
    update: {},
    create: {
      id: 'seed-event-birthday', groupId: domanGroup.id,
      title: "Laston Mzumala's Birthday", type: 'BIRTHDAY',
      eventDate: new Date('2008-06-08'), contributionType: 'FLEXIBLE',
      raisedSoFar: 8500, status: 'CLOSED',
    },
  });

  console.log('✅ Events seeded');
  console.log('\n🎉 Seed complete!');
  console.log('   Phone: +265882752624 | Password: Password123!  (Michael — member)');
  console.log('   Phone: +265997486222 | Password: Password123!  (Laston  — chair)');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
