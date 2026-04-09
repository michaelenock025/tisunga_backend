// prisma/seed.js
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding TISUNGA database...');

  const passwordHash = await bcrypt.hash('Password123!', 12);

  //Users

  const laston = await prisma.user.upsert({
    where:  { phone: '+265997486222' },
    update: { firstName: 'Laston', lastName: 'Mzumala', passwordHash, isVerified: true, isActive: true },
    create: { phone: '+265997486222', firstName: 'Laston', lastName: 'Mzumala', passwordHash, isVerified: true, isActive: true },
  });

  const joypus = await prisma.user.upsert({
    where:  { phone: '+265997489899' },
    update: { firstName: 'Joypus', lastName: 'Phiri', passwordHash, isVerified: true, isActive: true },
    create: { phone: '+265997489899', firstName: 'Joypus', lastName: 'Phiri', passwordHash, isVerified: true, isActive: true },
  });

  const zechael = await prisma.user.upsert({
    where:  { phone: '+265998928373' },
    update: { firstName: 'Zechael', lastName: 'Chisi', passwordHash, isVerified: true, isActive: true },
    create: { phone: '+265998928373', firstName: 'Zechael', lastName: 'Chisi', passwordHash, isVerified: true, isActive: true },
  });

  const michael = await prisma.user.upsert({
    where:  { phone: '+265882752624' },
    update: { firstName: 'Michael', lastName: 'Enock', passwordHash, isVerified: true, isActive: true },
    create: { phone: '+265882752624', firstName: 'Michael', lastName: 'Enock', passwordHash, isVerified: true, isActive: true },
  });

  const alinafe = await prisma.user.upsert({
    where:  { phone: '+265998765432' },
    update: { firstName: 'Alinafe', lastName: 'Zamwe', passwordHash, isVerified: true, isActive: true },
    create: { phone: '+265998765432', firstName: 'Alinafe', lastName: 'Zamwe', passwordHash, isVerified: true, isActive: true },
  });

  console.log('Users seeded');

  // Groups 
  const domanGroup = await prisma.group.upsert({
    where:  { groupCode: '467WEISH6' },
    update: {},
    create: {
      name:               'Doman Group',
      description:        'A community savings group based in Chikanda',
      location:           'Zomba, Chikanda',
      groupCode:          '467WEISH6',
      minContribution:    2000,
      savingPeriodMonths: 6,
      maxMembers:         10,
      totalSavings:       1000090,
      startDate:          new Date('2026-02-01'),
      endDate:            new Date('2027-02-01'),
      meetingDay:         'Friday',
      meetingTime:        '15:00',
      isActive:           true,
    },
  });

  const kaluluGroup = await prisma.group.upsert({
    where:  { groupCode: '2Q12QABCD' },
    update: {},
    create: {
      name:               'Kalulu Group',
      description:        'Savings group — minimum MK 2,000 weekly',
      location:           'Zomba',
      groupCode:          '2Q12QABCD',
      minContribution:    2000,
      savingPeriodMonths: 6,
      maxMembers:         8,
      totalSavings:       200000,
      startDate:          new Date('2026-01-15'),
      endDate:            new Date('2026-07-15'),
      meetingDay:         'Saturday',
      meetingTime:        '10:00',
      isActive:           true,
    },
  });

  console.log('Groups seeded');

  // Memberships
  // Uses groupId_userId compound unique — matches the fixed schema

  const upsertMembership = (groupId, userId, role, memberSavings = 0) =>
    prisma.groupMembership.upsert({
      where:  { groupId_userId: { groupId, userId } },
      update: { role, memberSavings },
      create: { groupId, userId, role, status: 'ACTIVE', memberSavings },
    });

  // Doman Group members
  await upsertMembership(domanGroup.id, laston.id,   'CHAIR',     300000);
  await upsertMembership(domanGroup.id, joypus.id,   'SECRETARY', 200000);
  await upsertMembership(domanGroup.id, zechael.id,  'TREASURER', 200000);
  await upsertMembership(domanGroup.id, michael.id,  'MEMBER',    200000);
  await upsertMembership(domanGroup.id, alinafe.id,  'MEMBER',    100090);

  // Kalulu Group — laston is also chair there (different group, same user allowed)
  await upsertMembership(kaluluGroup.id, laston.id, 'CHAIR', 50000);

  console.log('Memberships seeded (CHAIR, SECRETARY, TREASURER, 2× MEMBER)');

  // Active Loan

  const existingLoan = await prisma.loan.findFirst({
    where: { borrowerId: michael.id, groupId: domanGroup.id, status: 'ACTIVE' },
  });

  if (!existingLoan) {
    await prisma.loan.create({
      data: {
        transactionRef:   'TISU10001.01',
        borrowerId:       michael.id,
        approverId:       laston.id,
        groupId:          domanGroup.id,
        principalAmount:  650000,
        interestRate:     5,
        totalRepayable:   682500,
        remainingBalance: 350000,
        durationMonths:   9,
        purpose:          'Business expansion',
        dueDate:          new Date('2026-11-04'),
        approvedAt:       new Date('2026-02-01'),
        disbursedAt:      new Date('2026-02-01'),
        status:           'ACTIVE',
      },
    });
    console.log('Active loan seeded (Michael — MWK 650,000)');
  }

  // Events 
  await prisma.event.upsert({
    where:  { id: 'seed-event-wedding' },
    update: {},
    create: {
      id:               'seed-event-wedding',
      groupId:          domanGroup.id,
      title:            'Uchiae & Michael Wedding',
      type:             'WEDDING',
      eventDate:        new Date('2045-09-09'),
      contributionType: 'SAVINGS',
      fixedAmount:      600,
      raisedSoFar:      12000,
      status:           'UPCOMING',
      description:      'Wedding contribution — MK 600 each',
    },
  });

  await prisma.event.upsert({
    where:  { id: 'seed-event-birthday' },
    update: {},
    create: {
      id:               'seed-event-birthday',
      groupId:          domanGroup.id,
      title:            "Laston Mzumala's Birthday",
      type:             'BIRTHDAY',
      eventDate:        new Date('2026-07-08'),
      contributionType: 'FLEXIBLE',
      raisedSoFar:      8500,
      status:           'UPCOMING',
      description:      'Birthday celebration',
    },
  });

  console.log('✅ Events seeded');

  // Meeting

  const nextFriday = new Date();
  nextFriday.setDate(nextFriday.getDate() + ((5 - nextFriday.getDay() + 7) % 7 || 7));
  nextFriday.setHours(15, 0, 0, 0);

  const existingMeeting = await prisma.meeting.findFirst({
    where: { groupId: domanGroup.id, status: 'SCHEDULED' },
  });

  if (!existingMeeting) {
    const meeting = await prisma.meeting.create({
      data: {
        groupId:     domanGroup.id,
        createdBy:   laston.id,
        title:       'Monthly Savings Review',
        agenda:      '1. Review contributions  2. Loan requests  3. AOB',
        location:    'Chikanda Community Hall',
        scheduledAt: nextFriday,
        status:      'SCHEDULED',
        notifiedAt:  new Date(),
      },
    });

    // Pre-populate attendance (all ABSENT by default)
    const memberships = await prisma.groupMembership.findMany({
      where: { groupId: domanGroup.id, status: 'ACTIVE' },
    });

    await prisma.meetingAttendance.createMany({
      data: memberships.map((m) => ({
        meetingId: meeting.id,
        userId:    m.userId,
        status:    'ABSENT',
      })),
      skipDuplicates: true,
    });

    console.log(`✅ Meeting seeded — "${meeting.title}" on ${nextFriday.toDateString()}`);
  }

  // Sample Transactions

  const txExists = await prisma.transaction.findUnique({
    where: { tisuRef: 'TISU29993.90' },
  });

  if (!txExists) {
    await prisma.transaction.createMany({
      data: [
        {
          tisuRef:     'TISU29993.90',
          groupId:     domanGroup.id,
          userId:      michael.id,
          type:        'CONTRIBUTION',
          amount:      20000,
          description: 'Contribution from Michael Enock',
          balanceAfter: 1000090,
        },
        {
          tisuRef:     'TISU29993.91',
          groupId:     domanGroup.id,
          userId:      michael.id,
          type:        'LOAN_DISBURSEMENT',
          amount:      650000,
          description: 'Loan disbursed to Michael Enock',
          balanceAfter: 350090,
        },
      ],
      skipDuplicates: true,
    });
    console.log('Sample transactions seeded (2)');
  }

  console.log('Seed complete!\n');
  console.log('   Doman Group — login credentials:');
  console.log('   CHAIR     → +265997486222 / Password123!  (Laston Mzumala)');
  console.log('   SECRETARY → +265997489899 / Password123!  (Joypus Phiri)');
  console.log('   TREASURER → +265998928373 / Password123!  (Zechael Chisi)');
  console.log('   MEMBER    → +265882752624 / Password123!  (Michael Enock)');
  console.log('   MEMBER    → +265998765432 / Password123!  (Alinafe Zamwe)');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });