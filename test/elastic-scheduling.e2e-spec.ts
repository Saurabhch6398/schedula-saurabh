/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unused-vars */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AppointmentService } from '../src/appointment/appointment.service';

describe('Elastic Scheduling & Queueing System (e2e)', () => {
  jest.setTimeout(30000);

  let app: INestApplication<App>;
  let prisma: PrismaService;

  let doctorToken: string;
  let patientToken: string;
  let anotherPatientToken: string;

  let doctorProfileId: number;
  let patientProfileId: number;
  let anotherPatientProfileId: number;

  const testDate = '2031-10-06'; // A future Monday (Oct 6, 2031)
  const nextMonday = '2031-10-13'; // Future Monday + 7 days

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);

    // Clean DB
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
        name: 'Doctor Elastic',
        email: 'elastic@example.com',
        password: 'password123',
        role: 'DOCTOR',
      })
      .expect(HttpStatus.CREATED);

    const docLogin = await request(app.getHttpServer())
      .post('/login')
      .send({
        email: 'elastic@example.com',
        password: 'password123',
      })
      .expect(HttpStatus.OK);
    doctorToken = docLogin.body.token;

    await request(app.getHttpServer())
      .post('/doctor/profile')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({
        fullName: 'Bruce Elastic',
        specialization: 'Elasticity',
        experience: 10,
        qualification: 'MD',
        consultationFee: 250,
        availability: 'Mon 10AM-5PM',
      })
      .expect(HttpStatus.CREATED);

    const docDetails = await request(app.getHttpServer())
      .get('/doctor/profile')
      .set('Authorization', `Bearer ${doctorToken}`)
      .expect(HttpStatus.OK);
    doctorProfileId = docDetails.body.id;

    // 2. Create Patients
    await request(app.getHttpServer())
      .post('/signup')
      .send({
        name: 'Patient A',
        email: 'pat_a@example.com',
        password: 'password123',
        role: 'PATIENT',
      })
      .expect(HttpStatus.CREATED);

    const p1Login = await request(app.getHttpServer())
      .post('/login')
      .send({
        email: 'pat_a@example.com',
        password: 'password123',
      })
      .expect(HttpStatus.OK);
    patientToken = p1Login.body.token;

    await request(app.getHttpServer())
      .post('/patient/profile')
      .set('Authorization', `Bearer ${patientToken}`)
      .send({
        fullName: 'Tony Stark',
        age: 40,
        gender: 'Male',
        contact: '9876543210',
      })
      .expect(HttpStatus.CREATED);

    const p1Details = await request(app.getHttpServer())
      .get('/patient/profile')
      .set('Authorization', `Bearer ${patientToken}`)
      .expect(HttpStatus.OK);
    patientProfileId = p1Details.body.id;

    await request(app.getHttpServer())
      .post('/signup')
      .send({
        name: 'Patient B',
        email: 'pat_b@example.com',
        password: 'password123',
        role: 'PATIENT',
      })
      .expect(HttpStatus.CREATED);

    const p2Login = await request(app.getHttpServer())
      .post('/login')
      .send({
        email: 'pat_b@example.com',
        password: 'password123',
      })
      .expect(HttpStatus.OK);
    anotherPatientToken = p2Login.body.token;

    await request(app.getHttpServer())
      .post('/patient/profile')
      .set('Authorization', `Bearer ${anotherPatientToken}`)
      .send({
        fullName: 'Steve Rogers',
        age: 95,
        gender: 'Male',
        contact: '1111111111',
      })
      .expect(HttpStatus.CREATED);

    const p2Details = await request(app.getHttpServer())
      .get('/patient/profile')
      .set('Authorization', `Bearer ${anotherPatientToken}`)
      .expect(HttpStatus.OK);
    anotherPatientProfileId = p2Details.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. STREAM Scheduling - Shrink and Compress Flow', () => {
    let recurringId: number;

    beforeEach(async () => {
      // Clear scheduling type and availability
      await prisma.appointmentQueue.deleteMany({});
      await prisma.appointment.deleteMany({});
      await prisma.recurringAvailability.deleteMany({});

      // Set Doctor to STREAM
      await request(app.getHttpServer())
        .patch('/doctor/scheduling')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          type: 'STREAM',
          slotDuration: 15,
          bufferTime: 5,
        })
        .expect(HttpStatus.OK);

      // Create MONDAY availability
      const availRes = await request(app.getHttpServer())
        .post('/doctor/availability')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          dayOfWeek: 'MONDAY',
          startTime: '10:00',
          endTime: '12:00',
        })
        .expect(HttpStatus.CREATED);

      const listRes = await request(app.getHttpServer())
        .get('/doctor/availability')
        .set('Authorization', `Bearer ${doctorToken}`)
        .expect(HttpStatus.OK);

      recurringId = listRes.body[0].id;
    });

    it('should compress schedule (reducing buffer) when availability is shrunk but all appointments can fit', async () => {
      // Book 3 appointments on testDate (Oct 6, 2031 is Monday)
      // Slot 1: 10:00 - 10:15
      // Slot 2: 10:20 - 10:35
      // Slot 3: 10:40 - 10:55
      await request(app.getHttpServer())
        .post('/appointment')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          doctorId: doctorProfileId,
          date: testDate,
          startTime: '10:00',
          endTime: '10:15',
        })
        .expect(HttpStatus.CREATED);

      await request(app.getHttpServer())
        .post('/appointment')
        .set('Authorization', `Bearer ${anotherPatientToken}`)
        .send({
          doctorId: doctorProfileId,
          date: testDate,
          startTime: '10:20',
          endTime: '10:35',
        })
        .expect(HttpStatus.CREATED);

      await request(app.getHttpServer())
        .post('/appointment')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          doctorId: doctorProfileId,
          date: testDate,
          startTime: '10:40',
          endTime: '10:55',
        })
        .expect(HttpStatus.CREATED);

      // Shrink availability to 10:00 - 11:00 (duration = 60 mins)
      // 3 appointments need minimum 3 * 15 = 45 mins. So they all fit!
      // Buffer will be compressed.
      await request(app.getHttpServer())
        .patch(`/doctor/availability/${recurringId}`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          dayOfWeek: 'MONDAY',
          startTime: '10:00',
          endTime: '11:00',
        })
        .expect(HttpStatus.OK);

      // Verify appointments were compressed and rescheduled
      const appts = await prisma.appointment.findMany({
        where: { doctorProfileId },
        orderBy: { slotStart: 'asc' },
      });

      expect(appts.length).toBe(3);
      // First appointment start time is 10:00
      expect(appts[0].slotStart!.getUTCHours() * 60 + appts[0].slotStart!.getUTCMinutes()).toBe(10 * 60);
      expect(appts[0].isRescheduled).toBe(true);

      // Check rescheduling metadata audit trail
      expect(appts[0].reschedulingMetadata).toContain('COMPRESS_SCHEDULE');

      // Verify queue offers exist
      const queues = await prisma.appointmentQueue.findMany({
        where: { doctorProfileId, queueType: 'RESCHEDULE', status: 'OFFERED' },
      });
      expect(queues.length).toBe(3);
    });

    it('should reschedule overflow appointments to next available future date when they do not fit in shrunk window', async () => {
      // Book 3 appointments
      const app1 = await request(app.getHttpServer())
        .post('/appointment')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          doctorId: doctorProfileId,
          date: testDate,
          startTime: '10:00',
          endTime: '10:15',
        })
        .expect(HttpStatus.CREATED);

      await request(app.getHttpServer())
        .post('/appointment')
        .set('Authorization', `Bearer ${anotherPatientToken}`)
        .send({
          doctorId: doctorProfileId,
          date: testDate,
          startTime: '10:20',
          endTime: '10:35',
        })
        .expect(HttpStatus.CREATED);

      const app3 = await request(app.getHttpServer())
        .post('/appointment')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          doctorId: doctorProfileId,
          date: testDate,
          startTime: '10:40',
          endTime: '10:55',
        })
        .expect(HttpStatus.CREATED);

      // Shrink availability to 10:00 - 10:30 (Only 2 fit!)
      // The 3rd appointment (Tony Stark's 10:40) will overflow and should be rescheduled to next Monday (Oct 13, 2031)
      await request(app.getHttpServer())
        .patch(`/doctor/availability/${recurringId}`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          dayOfWeek: 'MONDAY',
          startTime: '10:00',
          endTime: '10:30',
        })
        .expect(HttpStatus.OK);

      // Verify the 3rd appointment was rescheduled to the next week (Oct 13, 2031)
      const rescheduledApp = await prisma.appointment.findUnique({
        where: { id: app3.body.data.id },
      });

      expect(rescheduledApp!.isRescheduled).toBe(true);
      expect(rescheduledApp!.slotStart!.toISOString()).toContain(nextMonday);
      expect(rescheduledApp!.reschedulingMetadata).toContain('AUTO_RESCHEDULE_OVERFLOW');
    });

    it('should rollback transaction and fail if no future slot is available to reschedule overflow patients', async () => {
      // Book 3 appointments
      await request(app.getHttpServer())
        .post('/appointment')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          doctorId: doctorProfileId,
          date: testDate,
          startTime: '10:00',
          endTime: '10:15',
        })
        .expect(HttpStatus.CREATED);

      await request(app.getHttpServer())
        .post('/appointment')
        .set('Authorization', `Bearer ${anotherPatientToken}`)
        .send({
          doctorId: doctorProfileId,
          date: testDate,
          startTime: '10:20',
          endTime: '10:35',
        })
        .expect(HttpStatus.CREATED);

      await request(app.getHttpServer())
        .post('/appointment')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          doctorId: doctorProfileId,
          date: testDate,
          startTime: '10:40',
          endTime: '10:55',
        })
        .expect(HttpStatus.CREATED);

      // Temporarily mock suggestNextAvailable to return null (no slots available)
      const originalSuggest = app.get(AppointmentService).suggestNextAvailable;
      app.get(AppointmentService).suggestNextAvailable = jest.fn().mockResolvedValue(null);

      // Expect a 400 Bad Request on shrink
      await request(app.getHttpServer())
        .patch(`/doctor/availability/${recurringId}`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          dayOfWeek: 'MONDAY',
          startTime: '10:00',
          endTime: '10:30',
        })
        .expect(HttpStatus.BAD_REQUEST);

      // Restore original helper
      app.get(AppointmentService).suggestNextAvailable = originalSuggest;

      // Verify that appointments were NOT modified (transaction was rolled back)
      const apps = await prisma.appointment.findMany({ where: { doctorProfileId } });
      for (const appItem of apps) {
        expect(appItem.isRescheduled).toBe(false);
      }
    });
  });

  describe('2. Patient Decisions (Accept/Reject)', () => {
    let appointmentId: number;

    beforeEach(async () => {
      await prisma.appointmentQueue.deleteMany({});
      await prisma.appointment.deleteMany({});
      await prisma.recurringAvailability.deleteMany({});

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

      await request(app.getHttpServer())
        .post('/doctor/availability')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          dayOfWeek: 'MONDAY',
          startTime: '10:00',
          endTime: '12:00',
        })
        .expect(HttpStatus.CREATED);

      const bookRes = await request(app.getHttpServer())
        .post('/appointment')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          doctorId: doctorProfileId,
          date: testDate,
          startTime: '10:00',
          endTime: '10:15',
        })
        .expect(HttpStatus.CREATED);
      appointmentId = bookRes.body.data.id;

      // Force mark it as rescheduled (simulating a shrink event)
      await prisma.appointment.update({
        where: { id: appointmentId },
        data: { isRescheduled: true, rescheduleAccepted: null },
      });

      await prisma.appointmentQueue.create({
        data: {
          doctorProfileId,
          patientProfileId,
          appointmentId,
          queueType: 'RESCHEDULE',
          status: 'OFFERED',
        },
      });
    });

    it('should allow patient to accept automatic reschedule', async () => {
      await request(app.getHttpServer())
        .post(`/appointment/${appointmentId}/accept-reschedule`)
        .set('Authorization', `Bearer ${patientToken}`)
        .expect(HttpStatus.OK);

      const appItem = await prisma.appointment.findUnique({ where: { id: appointmentId } });
      expect(appItem!.rescheduleAccepted).toBe(true);

      const queueEntry = await prisma.appointmentQueue.findFirst({
        where: { appointmentId, queueType: 'RESCHEDULE' },
      });
      expect(queueEntry!.status).toBe('ACCEPTED');
    });

    it('should allow patient to reject automatic reschedule (releases slot, puts in READY waitlist queue)', async () => {
      await request(app.getHttpServer())
        .post(`/appointment/${appointmentId}/reject-reschedule`)
        .set('Authorization', `Bearer ${patientToken}`)
        .expect(HttpStatus.OK);

      const appItem = await prisma.appointment.findUnique({ where: { id: appointmentId } });
      expect(appItem!.rescheduleAccepted).toBe(false);
      expect(appItem!.status).toBe('CANCELLED');

      // Check that patient was placed back in waitlist READY queue
      const waitlist = await prisma.appointmentQueue.findFirst({
        where: { patientProfileId, queueType: 'READY' },
      });
      expect(waitlist!.status).toBe('PENDING');
    });
  });

  describe('3. Expand Availability and READY Queue Processing', () => {
    let recurringId: number;

    beforeEach(async () => {
      await prisma.appointmentQueue.deleteMany({});
      await prisma.appointment.deleteMany({});
      await prisma.recurringAvailability.deleteMany({});

      await request(app.getHttpServer())
        .patch('/doctor/scheduling')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          type: 'STREAM',
          slotDuration: 15,
          bufferTime: 5,
        })
        .expect(HttpStatus.OK);

      const listRes = await request(app.getHttpServer())
        .post('/doctor/availability')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          dayOfWeek: 'MONDAY',
          startTime: '10:00',
          endTime: '11:00',
        })
        .expect(HttpStatus.CREATED);

      const allAvails = await request(app.getHttpServer())
        .get('/doctor/availability')
        .set('Authorization', `Bearer ${doctorToken}`)
        .expect(HttpStatus.OK);

      recurringId = allAvails.body[0].id;
    });

    it('should automatically assign new available slots to waitlisted READY queue patients when availability is expanded', async () => {
      // Patient A joins waitlist READY queue
      await request(app.getHttpServer())
        .post('/appointment/waitlist')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({ doctorId: doctorProfileId })
        .expect(HttpStatus.CREATED);

      // Expand availability to 09:00 - 11:00 (added 09:00 - 10:00 hour)
      await request(app.getHttpServer())
        .patch(`/doctor/availability/${recurringId}`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          dayOfWeek: 'MONDAY',
          startTime: '09:00',
          endTime: '11:00',
        })
        .expect(HttpStatus.OK);

      // Verify that waitlisted patient was offered one of the newly created slots
      const offer = await prisma.appointmentQueue.findFirst({
        where: { patientProfileId, queueType: 'READY' },
      });

      expect(offer!.status).toBe('OFFERED');
      expect(offer!.offeredSlotStart).toBeDefined();
    });
  });
});
