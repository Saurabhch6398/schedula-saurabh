/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unused-vars */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ReminderService } from './../src/reminder/reminder.service';

describe('Automated Appointment Reminder System (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let patientToken: string;
  let doctorToken: string;

  let doctorProfileId: number;
  let patientProfileId: number;
  let patientUserId: number;

  beforeAll(async () => {
    jest.setTimeout(30000);
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);

    // Clean DB
    await prisma.notification.deleteMany({});
    await prisma.appointmentQueue.deleteMany({});
    await prisma.appointment.deleteMany({});
    await prisma.waveSchedule.deleteMany({});
    await prisma.recurringAvailability.deleteMany({});
    await prisma.customAvailability.deleteMany({});
    await prisma.doctorProfile.deleteMany({});
    await prisma.patientProfile.deleteMany({});
    await prisma.user.deleteMany({});

    // 1. Create Doctor
    await request(app.getHttpServer())
      .post('/signup')
      .send({
        name: 'Stephen Strange',
        email: 'strange@example.com',
        password: 'password123',
        role: 'DOCTOR',
      })
      .expect(HttpStatus.CREATED);

    const docLogin = await request(app.getHttpServer())
      .post('/login')
      .send({
        email: 'strange@example.com',
        password: 'password123',
      })
      .expect(HttpStatus.OK);
    doctorToken = docLogin.body.token;

    await request(app.getHttpServer())
      .post('/doctor/profile')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({
        fullName: 'Stephen Strange',
        specialization: 'Mystic Arts',
        experience: 15,
        qualification: 'MD PhD',
        consultationFee: 500,
        availability: 'Mon-Fri 9AM-5PM',
      })
      .expect(HttpStatus.CREATED);

    const docDetails = await request(app.getHttpServer())
      .get('/doctor/profile')
      .set('Authorization', `Bearer ${doctorToken}`)
      .expect(HttpStatus.OK);
    doctorProfileId = docDetails.body.id;

    // 2. Create Patient
    await request(app.getHttpServer())
      .post('/signup')
      .send({
        name: 'Peter Parker',
        email: 'peter@example.com',
        password: 'password123',
        role: 'PATIENT',
      })
      .expect(HttpStatus.CREATED);

    const pLogin = await request(app.getHttpServer())
      .post('/login')
      .send({
        email: 'peter@example.com',
        password: 'password123',
      })
      .expect(HttpStatus.OK);
    patientToken = pLogin.body.token;

    await request(app.getHttpServer())
      .post('/patient/profile')
      .set('Authorization', `Bearer ${patientToken}`)
      .send({
        fullName: 'Peter Parker',
        age: 18,
        gender: 'Male',
        contact: '1234567890',
      })
      .expect(HttpStatus.CREATED);

    const pDetails = await prisma.patientProfile.findFirst({
      where: { fullName: 'Peter Parker' },
    });
    patientProfileId = pDetails!.id;
    patientUserId = pDetails!.userId;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Reminder Cron Job logic', () => {
    it('should generate reminders only for valid upcoming appointments inside the 24h window', async () => {
      const now = new Date();

      // Clear existing notifications/appointments
      await prisma.notification.deleteMany({});
      await prisma.appointment.deleteMany({});

      // 1. Stream appointment inside window (2 hours from now)
      const streamApp = await prisma.appointment.create({
        data: {
          doctorProfileId,
          patientProfileId,
          appointmentType: 'STREAM',
          slotStart: new Date(now.getTime() + 2 * 60 * 60 * 1000),
          slotEnd: new Date(now.getTime() + 2.25 * 60 * 60 * 1000),
          status: 'BOOKED',
        },
      });

      // 2. Wave appointment inside window (3 hours from now)
      const waveApp = await prisma.appointment.create({
        data: {
          doctorProfileId,
          patientProfileId,
          appointmentType: 'WAVE',
          slotStart: new Date(now.getTime() + 3 * 60 * 60 * 1000),
          slotEnd: new Date(now.getTime() + 4 * 60 * 60 * 1000),
          tokenNumber: 7,
          status: 'BOOKED',
        },
      });

      // 3. Completed appointment inside window (4 hours from now)
      const completedApp = await prisma.appointment.create({
        data: {
          doctorProfileId,
          patientProfileId,
          appointmentType: 'STREAM',
          slotStart: new Date(now.getTime() + 4 * 60 * 60 * 1000),
          slotEnd: new Date(now.getTime() + 4.25 * 60 * 60 * 1000),
          status: 'COMPLETED',
        },
      });

      // 4. Cancelled appointment inside window (5 hours from now)
      const cancelledApp = await prisma.appointment.create({
        data: {
          doctorProfileId,
          patientProfileId,
          appointmentType: 'STREAM',
          slotStart: new Date(now.getTime() + 5 * 60 * 60 * 1000),
          slotEnd: new Date(now.getTime() + 5.25 * 60 * 60 * 1000),
          status: 'CANCELLED',
        },
      });

      // 5. Far-future appointment outside window (30 hours from now)
      const farApp = await prisma.appointment.create({
        data: {
          doctorProfileId,
          patientProfileId,
          appointmentType: 'STREAM',
          slotStart: new Date(now.getTime() + 30 * 60 * 60 * 1000),
          slotEnd: new Date(now.getTime() + 30.25 * 60 * 60 * 1000),
          status: 'BOOKED',
        },
      });

      // Trigger reminder check via API
      const res = await request(app.getHttpServer())
        .post('/appointments/reminders/trigger')
        .set('Authorization', `Bearer ${patientToken}`)
        .expect(HttpStatus.OK);

      expect(res.body.success).toBe(true);
      expect(res.body.data.sent).toBe(2);

      // Verify notifications generated
      const notifications = await prisma.notification.findMany({
        where: { userId: patientUserId, type: 'APPOINTMENT_REMINDER' },
        orderBy: { appointmentId: 'asc' },
      });

      expect(notifications.length).toBe(2);

      // Stream notification details
      const streamNotif = notifications.find(
        (n) => n.appointmentId === streamApp.id,
      );
      expect(streamNotif).toBeDefined();
      expect(streamNotif!.title).toBe('Appointment Reminder');
      expect(streamNotif!.message).toContain('Stephen Strange');
      expect(streamNotif!.message).toContain('on');
      expect(streamNotif!.message).toContain('at');

      // Wave notification details
      const waveNotif = notifications.find(
        (n) => n.appointmentId === waveApp.id,
      );
      expect(waveNotif).toBeDefined();
      expect(waveNotif!.title).toBe('Appointment Reminder');
      expect(waveNotif!.message).toContain('Stephen Strange');
      expect(waveNotif!.message).toContain('Reporting Time:');
      expect(waveNotif!.message).toContain('Token Number: 7');
    });

    it('should not create duplicate reminder notifications if triggered multiple times', async () => {
      // Trigger reminder check again via API
      const res = await request(app.getHttpServer())
        .post('/appointments/reminders/trigger')
        .set('Authorization', `Bearer ${patientToken}`)
        .expect(HttpStatus.OK);

      expect(res.body.success).toBe(true);
      expect(res.body.data.sent).toBe(0); // 0 reminders sent because they already exist

      const notifications = await prisma.notification.findMany({
        where: { userId: patientUserId, type: 'APPOINTMENT_REMINDER' },
      });
      expect(notifications.length).toBe(2); // Still exactly 2
    });
  });
});
