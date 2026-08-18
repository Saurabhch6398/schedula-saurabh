/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unused-vars */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { NotificationService } from './../src/notification/notification.service';

describe('Event-Based Notification System & Appointment Integration (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  let doctorToken: string;
  let patientToken: string;
  let otherPatientToken: string;

  let doctorProfileId: number;
  let patientProfileId: number;

  const testDate = '2031-09-20'; // Future date to avoid "past slot" issues
  const testSlotStart = '10:00';
  const testSlotEnd = '10:15';

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
        name: 'Doctor Strange',
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

    // Set STREAM scheduling
    await request(app.getHttpServer())
      .patch('/doctor/scheduling')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({
        type: 'STREAM',
        slotDuration: 15,
        bufferTime: 5,
      })
      .expect(HttpStatus.OK);

    // Create doctor availability
    await request(app.getHttpServer())
      .post('/doctor/availability')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({
        dayOfWeek: 'SATURDAY', // 2031-09-20 is Saturday
        startTime: '10:00',
        endTime: '17:00',
      })
      .expect(HttpStatus.CREATED);

    // 2. Create Patient 1
    await request(app.getHttpServer())
      .post('/signup')
      .send({
        name: 'Peter Parker',
        email: 'peter@example.com',
        password: 'password123',
        role: 'PATIENT',
      })
      .expect(HttpStatus.CREATED);

    const p1Login = await request(app.getHttpServer())
      .post('/login')
      .send({
        email: 'peter@example.com',
        password: 'password123',
      })
      .expect(HttpStatus.OK);
    patientToken = p1Login.body.token;

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

    // 3. Create Patient 2 (Other Patient)
    await request(app.getHttpServer())
      .post('/signup')
      .send({
        name: 'Ned Leeds',
        email: 'ned@example.com',
        password: 'password123',
        role: 'PATIENT',
      })
      .expect(HttpStatus.CREATED);

    const p2Login = await request(app.getHttpServer())
      .post('/login')
      .send({
        email: 'ned@example.com',
        password: 'password123',
      })
      .expect(HttpStatus.OK);
    otherPatientToken = p2Login.body.token;

    await request(app.getHttpServer())
      .post('/patient/profile')
      .set('Authorization', `Bearer ${otherPatientToken}`)
      .send({
        fullName: 'Ned Leeds',
        age: 18,
        gender: 'Male',
        contact: '9999999999',
      })
      .expect(HttpStatus.CREATED);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Notification Workflows E2E', () => {
    let appointmentId: number;
    let notificationId: number;

    it('1. should create APPOINTMENT_BOOKED notification when booking successfully', async () => {
      // Book appointment
      const bookRes = await request(app.getHttpServer())
        .post('/appointments')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          doctorId: doctorProfileId,
          date: testDate,
          startTime: testSlotStart,
          endTime: testSlotEnd,
        })
        .expect(HttpStatus.CREATED);

      appointmentId = bookRes.body.data.id;
      expect(appointmentId).toBeDefined();

      // Retrieve notifications
      const notifRes = await request(app.getHttpServer())
        .get('/notifications')
        .set('Authorization', `Bearer ${patientToken}`)
        .expect(HttpStatus.OK);

      expect(notifRes.body.success).toBe(true);
      expect(notifRes.body.data.length).toBe(1);

      const notif = notifRes.body.data[0];
      notificationId = notif.id;
      expect(notif.type).toBe('APPOINTMENT_BOOKED');
      expect(notif.title).toBe('Appointment Booked');
      expect(notif.message).toContain(
        'Your appointment with Dr. Stephen Strange has been booked successfully',
      );
      expect(notif.message).toContain('20 September at 10:00 AM');
      expect(notif.isRead).toBe(false);
      expect(notif.appointmentId).toBe(appointmentId);
    });

    it('2. should not create duplicate booking notification if identical request is processed again', async () => {
      // We check our service trigger directly or query database to confirm idempotency.
      // Since booking duplicate slot itself fails, let's manually invoke the triggerNotification check to ensure no duplicates.
      const service = app.get(NotificationService);

      const duplicateNotif = await prisma.$transaction(async (tx) => {
        return await service.triggerNotification(
          tx,
          appointmentId,
          'APPOINTMENT_BOOKED',
        );
      });

      expect(duplicateNotif.id).toBe(notificationId);

      const count = await prisma.notification.count({
        where: { appointmentId, type: 'APPOINTMENT_BOOKED' },
      });
      expect(count).toBe(1);
    });

    it('3. should create APPOINTMENT_RESCHEDULED notification when rescheduling successfully', async () => {
      // Reschedule appointment
      await request(app.getHttpServer())
        .patch(`/appointments/${appointmentId}/reschedule`)
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          date: testDate,
          startTime: '11:00',
          endTime: '11:15',
        })
        .expect(HttpStatus.OK);

      // Retrieve notifications (should have 2: Booked and Rescheduled, sorted latest first)
      const notifRes = await request(app.getHttpServer())
        .get('/notifications')
        .set('Authorization', `Bearer ${patientToken}`)
        .expect(HttpStatus.OK);

      expect(notifRes.body.data.length).toBe(2);
      expect(notifRes.body.data[0].type).toBe('APPOINTMENT_RESCHEDULED');
      expect(notifRes.body.data[0].title).toBe('Appointment Rescheduled');
      expect(notifRes.body.data[0].message).toContain(
        'Your appointment has been rescheduled to 20 September at 11:00 AM',
      );
      expect(notifRes.body.data[1].type).toBe('APPOINTMENT_BOOKED');
    });

    it('4. should allow multiple reschedules and prevent duplicates for the same target slot', async () => {
      // Reschedule again to a different slot
      await request(app.getHttpServer())
        .patch(`/appointments/${appointmentId}/reschedule`)
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          date: testDate,
          startTime: '11:30',
          endTime: '11:45',
        })
        .expect(HttpStatus.OK);

      // Verify that a third notification was created (second reschedule)
      const notifRes1 = await request(app.getHttpServer())
        .get('/notifications')
        .set('Authorization', `Bearer ${patientToken}`)
        .expect(HttpStatus.OK);
      expect(notifRes1.body.data.length).toBe(3);
      expect(notifRes1.body.data[0].message).toContain('11:30 AM');

      // Attempt duplicate reschedule notification manually to ensure duplicate check functions
      const service = app.get(NotificationService);
      const duplicateNotif = await prisma.$transaction(async (tx) => {
        return await service.triggerNotification(
          tx,
          appointmentId,
          'APPOINTMENT_RESCHEDULED',
        );
      });

      // The message is the same as the last one, so it should return the last notification.
      expect(duplicateNotif.id).toBe(notifRes1.body.data[0].id);

      const count = await prisma.notification.count({
        where: { appointmentId, type: 'APPOINTMENT_RESCHEDULED' },
      });
      expect(count).toBe(2); // One for 11:00, one for 11:30
    });

    it('5. should mark notification as read successfully', async () => {
      await request(app.getHttpServer())
        .patch(`/notifications/${notificationId}/read`)
        .set('Authorization', `Bearer ${patientToken}`)
        .expect(HttpStatus.OK);

      const notifRes = await request(app.getHttpServer())
        .get('/notifications')
        .set('Authorization', `Bearer ${patientToken}`)
        .expect(HttpStatus.OK);

      const notif = notifRes.body.data.find(
        (n: any) => n.id === notificationId,
      );
      expect(notif.isRead).toBe(true);
    });

    it('6. should reject marking a notification as read if it is owned by another patient', async () => {
      await request(app.getHttpServer())
        .patch(`/notifications/${notificationId}/read`)
        .set('Authorization', `Bearer ${otherPatientToken}`)
        .expect(HttpStatus.FORBIDDEN);
    });

    it('7. should create APPOINTMENT_CANCELLED notification when cancelling successfully', async () => {
      await request(app.getHttpServer())
        .patch(`/appointments/${appointmentId}/cancel`)
        .set('Authorization', `Bearer ${patientToken}`)
        .send({ cancellationReason: 'Personal emergency' })
        .expect(HttpStatus.OK);

      const notifRes = await request(app.getHttpServer())
        .get('/notifications')
        .set('Authorization', `Bearer ${patientToken}`)
        .expect(HttpStatus.OK);

      // Latest first
      expect(notifRes.body.data[0].type).toBe('APPOINTMENT_CANCELLED');
      expect(notifRes.body.data[0].title).toBe('Appointment Cancelled');
      expect(notifRes.body.data[0].message).toContain(
        'Your appointment scheduled on 20 September at 11:30 AM has been cancelled',
      );
    });

    it('8. should prevent duplicate cancellation notifications', async () => {
      const service = app.get(NotificationService);
      const duplicateNotif = await prisma.$transaction(async (tx) => {
        return await service.triggerNotification(
          tx,
          appointmentId,
          'APPOINTMENT_CANCELLED',
        );
      });

      const count = await prisma.notification.count({
        where: { appointmentId, type: 'APPOINTMENT_CANCELLED' },
      });
      expect(count).toBe(1);
    });
  });
});
