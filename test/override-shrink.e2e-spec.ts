import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Custom Override Shrink (e2e)', () => {
  jest.setTimeout(30000);

  let app: INestApplication<App>;
  let prisma: PrismaService;

  let doctorToken: string;
  let patient1Token: string;
  let patient2Token: string;

  let doctorProfileId: number;

  const testDate = '2030-09-10'; // A date far in the future

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);

    // Teardown database
    await prisma.appointmentQueue.deleteMany({});
    await prisma.appointment.deleteMany({});
    await prisma.waveSchedule.deleteMany({});
    await prisma.recurringAvailability.deleteMany({});
    await prisma.customAvailability.deleteMany({});
    await prisma.doctorProfile.deleteMany({});
    await prisma.patientProfile.deleteMany({});
    await prisma.user.deleteMany({});

    // Register & login doctor
    await request(app.getHttpServer())
      .post('/signup')
      .send({
        name: 'Doctor Doom',
        email: 'doom@example.com',
        password: 'password123',
        role: 'DOCTOR',
      })
      .expect(HttpStatus.CREATED);

    const docLogin = await request(app.getHttpServer())
      .post('/login')
      .send({
        email: 'doom@example.com',
        password: 'password123',
      })
      .expect(HttpStatus.OK);
    doctorToken = docLogin.body.token;

    // Create doctor profile
    await request(app.getHttpServer())
      .post('/doctor/profile')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({
        fullName: 'Doctor Doom',
        specialization: 'Cardiology',
        experience: 20,
        qualification: 'PhD',
        consultationFee: 300,
        availability: 'Mon-Fri 10AM-5PM',
      })
      .expect(HttpStatus.CREATED);

    const docProfileDetails = await request(app.getHttpServer())
      .get('/doctor/profile')
      .set('Authorization', `Bearer ${doctorToken}`)
      .expect(HttpStatus.OK);
    doctorProfileId = docProfileDetails.body.id;

    // Register & login Patient 1
    await request(app.getHttpServer())
      .post('/signup')
      .send({
        name: 'Jane Doe',
        email: 'jane@example.com',
        password: 'password123',
        role: 'PATIENT',
      })
      .expect(HttpStatus.CREATED);

    const p1Login = await request(app.getHttpServer())
      .post('/login')
      .send({
        email: 'jane@example.com',
        password: 'password123',
      })
      .expect(HttpStatus.OK);
    patient1Token = p1Login.body.token;

    await request(app.getHttpServer())
      .post('/patient/profile')
      .set('Authorization', `Bearer ${patient1Token}`)
      .send({
        fullName: 'Jane Doe',
        age: 25,
        gender: 'Female',
        contact: '1234567890',
      })
      .expect(HttpStatus.CREATED);

    // Register & login Patient 2
    await request(app.getHttpServer())
      .post('/signup')
      .send({
        name: 'John Doe',
        email: 'john@example.com',
        password: 'password123',
        role: 'PATIENT',
      })
      .expect(HttpStatus.CREATED);

    const p2Login = await request(app.getHttpServer())
      .post('/login')
      .send({
        email: 'john@example.com',
        password: 'password123',
      })
      .expect(HttpStatus.OK);
    patient2Token = p2Login.body.token;

    await request(app.getHttpServer())
      .post('/patient/profile')
      .set('Authorization', `Bearer ${patient2Token}`)
      .send({
        fullName: 'John Doe',
        age: 30,
        gender: 'Male',
        contact: '0987654321',
      })
      .expect(HttpStatus.CREATED);
  });

  afterAll(async () => {
    await app.close();
  });

  it('should verify override shrink and automatic rescheduling within transaction', async () => {
    // 1. Select STREAM scheduling type
    await prisma.doctorProfile.update({
      where: { id: doctorProfileId },
      data: {
        schedulingType: 'STREAM',
        slotDuration: 15,
        bufferTime: 5,
      },
    });

    // 2. Create custom override availability for Doctor Doom on testDate
    // Let's create an override from 10:00 to 12:00
    await request(app.getHttpServer())
      .post('/doctor/availability/override')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({
        date: testDate,
        startTime: '10:00',
        endTime: '12:00',
      })
      .expect(HttpStatus.CREATED);

    const overrides = await prisma.customAvailability.findMany({
      where: { doctorProfileId },
    });
    expect(overrides.length).toBe(1);
    const overrideId = overrides[0].id;

    // 3. Book two appointments on this override
    // Slot 1: 10:00-10:15 -> Patient 1
    // Slot 2: 10:20-10:35 -> Patient 2
    const resApp1 = await request(app.getHttpServer())
      .post('/appointments')
      .set('Authorization', `Bearer ${patient1Token}`)
      .send({
        doctorId: doctorProfileId,
        slot: '10:00',
        date: testDate,
      })
      .expect(HttpStatus.CREATED);

    const resApp2 = await request(app.getHttpServer())
      .post('/appointments')
      .set('Authorization', `Bearer ${patient2Token}`)
      .send({
        doctorId: doctorProfileId,
        slot: '10:20',
        date: testDate,
      })
      .expect(HttpStatus.CREATED);

    // 4. Shrink the override to 11:00-12:00
    // This removes 10:00-11:00, which affects BOTH booked appointments!
    // They should automatically reschedule to the remaining part of the override:
    // Slot 1: 11:00-11:15 (first available)
    // Slot 2: 11:20-11:35 (second available, sequentially scheduled and aware of slot 1 booking)
    const shrinkRes = await request(app.getHttpServer())
      .patch(`/doctor/availability/override/shrink/${overrideId}`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({
        startTime: '11:00',
        endTime: '12:00',
      })
      .expect(HttpStatus.OK);

    expect(shrinkRes.body.affectedCount).toBe(2);

    // Verify CustomAvailability is updated
    const updatedOverride = await prisma.customAvailability.findUnique({
      where: { id: overrideId },
    });
    expect(updatedOverride!.startTime).toBe('11:00');
    expect(updatedOverride!.endTime).toBe('12:00');

    // Verify Patient 1 appointment has been rescheduled to 11:00
    const app1 = await prisma.appointment.findUnique({
      where: { id: resApp1.body.data.id },
    });
    expect(app1!.wasAutoRescheduled).toBe(true);
    expect(app1!.previousDate).toBe(testDate);
    expect(app1!.previousStartTime).toBe('10AM');
    expect(app1!.previousEndTime).toBe('10:15AM');
    
    // New slot should be 11:00 in UTC
    expect(app1!.slotStart!.getUTCHours()).toBe(11);
    expect(app1!.slotStart!.getUTCMinutes()).toBe(0);

    // Verify Patient 2 appointment has been rescheduled to 11:20 (sequentially aware of Patient 1's new slot!)
    const app2 = await prisma.appointment.findUnique({
      where: { id: resApp2.body.data.id },
    });
    expect(app2!.wasAutoRescheduled).toBe(true);
    expect(app2!.previousDate).toBe(testDate);
    expect(app2!.previousStartTime).toBe('10:20AM');
    expect(app2!.previousEndTime).toBe('10:35AM');

    expect(app2!.slotStart!.getUTCHours()).toBe(11);
    expect(app2!.slotStart!.getUTCMinutes()).toBe(20);

    // 5. Test retrieval via GET /appointments/me
    const meRes = await request(app.getHttpServer())
      .get('/appointments/me')
      .set('Authorization', `Bearer ${patient1Token}`)
      .expect(HttpStatus.OK);

    const returnedApp1 = meRes.body.data.find((a: any) => a.id === app1!.id);
    expect(returnedApp1).toBeDefined();
    expect(returnedApp1.wasAutoRescheduled).toBe(true);
    expect(returnedApp1.previousDate).toBe(testDate);
    expect(returnedApp1.previousStartTime).toBe('10AM');
    expect(returnedApp1.previousEndTime).toBe('10:15AM');
  });

  it('should reject shrink operation and roll back transaction if an affected appointment cannot be rescheduled', async () => {
    // 1. Reset availability: set override to 10:00-11:00
    await prisma.appointmentQueue.deleteMany({});
    await prisma.appointment.deleteMany({});

    const overrides = await prisma.customAvailability.findMany({
      where: { doctorProfileId },
    });
    const overrideId = overrides[0].id;
    await prisma.customAvailability.update({
      where: { id: overrideId },
      data: {
        startTime: '10:00',
        endTime: '11:00',
        isAvailable: true,
      },
    });

    // Book two appointments
    const resApp1 = await request(app.getHttpServer())
      .post('/appointments')
      .set('Authorization', `Bearer ${patient1Token}`)
      .send({
        doctorId: doctorProfileId,
        slot: '10:00',
        date: testDate,
      })
      .expect(HttpStatus.CREATED);

    const resApp2 = await request(app.getHttpServer())
      .post('/appointments')
      .set('Authorization', `Bearer ${patient2Token}`)
      .send({
        doctorId: doctorProfileId,
        slot: '10:20',
        date: testDate,
      })
      .expect(HttpStatus.CREATED);

    // Try shrinking override to 11:00-11:15 (which only has capacity for one slot: 11:00-11:15)
    // There are NO recurring schedules or other overrides. So only ONE of the two appointments can be rescheduled.
    // The second appointment will fail to reschedule, causing the entire transaction to fail and roll back!
    await request(app.getHttpServer())
      .patch(`/doctor/availability/override/shrink/${overrideId}`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({
        startTime: '11:00',
        endTime: '11:15',
      })
      .expect(HttpStatus.BAD_REQUEST);

    // Verify database rolled back: override still 10:00-11:00, and appointments did not change!
    const finalOverride = await prisma.customAvailability.findUnique({
      where: { id: overrideId },
    });
    expect(finalOverride!.startTime).toBe('10:00');
    expect(finalOverride!.endTime).toBe('11:00');

    const app1 = await prisma.appointment.findUnique({
      where: { id: resApp1.body.data.id },
    });
    expect(app1!.slotStart!.getUTCHours()).toBe(10);
    expect(app1!.slotStart!.getUTCMinutes()).toBe(0);
  });
});
