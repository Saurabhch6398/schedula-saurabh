/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unused-vars */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Appointment Booking & Management System (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  let doctorToken: string;
  let patientToken: string;
  let anotherPatientToken: string;

  let doctorProfileId: number;
  let patientProfileId: number;
  let anotherPatientProfileId: number;

  const testDate = '2031-09-20'; // Future date to avoid "past slot" issues

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
        name: 'Doctor Banner',
        email: 'banner@example.com',
        password: 'password123',
        role: 'DOCTOR',
      })
      .expect(HttpStatus.CREATED);

    const docLogin = await request(app.getHttpServer())
      .post('/login')
      .send({
        email: 'banner@example.com',
        password: 'password123',
      })
      .expect(HttpStatus.OK);
    doctorToken = docLogin.body.token;

    await request(app.getHttpServer())
      .post('/doctor/profile')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({
        fullName: 'Bruce Banner',
        specialization: 'Gamma Radiation',
        experience: 12,
        qualification: 'PhD',
        consultationFee: 300,
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

    // Create doctor availability for TUESDAY
    await request(app.getHttpServer())
      .post('/doctor/availability')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({
        dayOfWeek: 'TUESDAY', // Sept 20, 2031 is Saturday, let's verify dayOfWeek
        startTime: '10:00',
        endTime: '17:00',
      })
      .expect(HttpStatus.CREATED);

    // Sept 20, 2031 is Saturday, let's also add SATURDAY availability so we can book on testDate
    await request(app.getHttpServer())
      .post('/doctor/availability')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({
        dayOfWeek: 'SATURDAY',
        startTime: '10:00',
        endTime: '17:00',
      })
      .expect(HttpStatus.CREATED);

    // 2. Create Patient 1
    await request(app.getHttpServer())
      .post('/signup')
      .send({
        name: 'Tony Stark',
        email: 'tony@example.com',
        password: 'password123',
        role: 'PATIENT',
      })
      .expect(HttpStatus.CREATED);

    const p1Login = await request(app.getHttpServer())
      .post('/login')
      .send({
        email: 'tony@example.com',
        password: 'password123',
      })
      .expect(HttpStatus.OK);
    patientToken = p1Login.body.token;

    await request(app.getHttpServer())
      .post('/patient/profile')
      .set('Authorization', `Bearer ${patientToken}`)
      .send({
        fullName: 'Tony Stark',
        age: 45,
        gender: 'Male',
        contact: '9876543210',
      })
      .expect(HttpStatus.CREATED);

    // 3. Create Patient 2
    await request(app.getHttpServer())
      .post('/signup')
      .send({
        name: 'Steve Rogers',
        email: 'steve@example.com',
        password: 'password123',
        role: 'PATIENT',
      })
      .expect(HttpStatus.CREATED);

    const p2Login = await request(app.getHttpServer())
      .post('/login')
      .send({
        email: 'steve@example.com',
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
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. Advanced Slot Booking & Validations', () => {
    it('should book an appointment with startTime and endTime successfully', async () => {
      const res = await request(app.getHttpServer())
        .post('/appointment')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          doctorId: doctorProfileId,
          date: testDate,
          startTime: '10:00',
          endTime: '10:15',
        })
        .expect(HttpStatus.CREATED);

      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('BOOKED');
      expect(res.body.data.appointmentType).toBe('STREAM');
    });

    it('should reject booking the same slot twice (Duplicate Booking)', async () => {
      const res = await request(app.getHttpServer())
        .post('/appointment')
        .set('Authorization', `Bearer ${anotherPatientToken}`)
        .send({
          doctorId: doctorProfileId,
          date: testDate,
          startTime: '10:00',
          endTime: '10:15',
        })
        .expect(HttpStatus.CONFLICT);

      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Slot already booked');
    });

    it('should reject booking with invalid slot duration', async () => {
      const res = await request(app.getHttpServer())
        .post('/appointment')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          doctorId: doctorProfileId,
          date: testDate,
          startTime: '10:20',
          endTime: '10:45', // Duration is 25m, doctor slotDuration is 15m
        })
        .expect(HttpStatus.BAD_REQUEST);

      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain(
        'Booking duration does not match doctor slot duration',
      );
    });

    it('should reject booking in the past or within 30-minute buffer', async () => {
      const pastDate = '2020-01-01';
      const res = await request(app.getHttpServer())
        .post('/appointment')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          doctorId: doctorProfileId,
          date: pastDate,
          startTime: '10:00',
          endTime: '10:15',
        })
        .expect(HttpStatus.BAD_REQUEST);

      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Cannot book appointment in the past');
    });

    it('should reject booking if slot is not in availability window', async () => {
      const res = await request(app.getHttpServer())
        .post('/appointment')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          doctorId: doctorProfileId,
          date: testDate,
          startTime: '08:00', // Doctor availability starts at 10:00
          endTime: '08:15',
        })
        .expect(HttpStatus.BAD_REQUEST);

      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Slot is not available');
    });
  });

  describe('2. Patient Views & Rescheduling', () => {
    let appointmentId: number;

    beforeAll(async () => {
      // Find the existing booking to reschedule
      const res = await request(app.getHttpServer())
        .get('/appointment/my')
        .set('Authorization', `Bearer ${patientToken}`)
        .expect(HttpStatus.OK);
      appointmentId = res.body.data[0].id;
    });

    it('should retrieve patient appointments with doctor details and status', async () => {
      const res = await request(app.getHttpServer())
        .get('/appointment/my')
        .set('Authorization', `Bearer ${patientToken}`)
        .expect(HttpStatus.OK);

      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data[0].doctor.fullName).toBe('Bruce Banner');
      expect(res.body.data[0].status).toBe('BOOKED');
    });

    it('should reschedule active appointment successfully', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/appointment/${appointmentId}/reschedule`)
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          date: testDate,
          startTime: '11:00',
          endTime: '11:15',
        })
        .expect(HttpStatus.OK);

      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Appointment rescheduled successfully');

      // Verify slot matches new time
      const details = await request(app.getHttpServer())
        .get(`/appointment/${appointmentId}`)
        .set('Authorization', `Bearer ${patientToken}`)
        .expect(HttpStatus.OK);

      expect(
        new Date(details.body.data.slotStart as string).getUTCHours(),
      ).toBe(11);
    });

    it('should allow booking and rescheduling using unified slotId, newSlotId and newDate fields', async () => {
      // 1. Book a stream appointment using slotId
      const bookRes = await request(app.getHttpServer())
        .post('/appointment')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          doctorId: doctorProfileId,
          date: testDate,
          slotId: '13:00-13:15',
        })
        .expect(HttpStatus.CREATED);

      expect(bookRes.body.success).toBe(true);
      expect(bookRes.body.data.status).toBe('BOOKED');
      const bookedAppId = bookRes.body.data.id;

      // 2. Reschedule it using newSlotId and newDate
      const rescheduleRes = await request(app.getHttpServer())
        .patch(`/appointment/${bookedAppId}/reschedule`)
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          newDate: testDate,
          newSlotId: '14:00-14:15',
        })
        .expect(HttpStatus.OK);

      expect(rescheduleRes.body.success).toBe(true);
      expect(rescheduleRes.body.message).toBe(
        'Appointment rescheduled successfully',
      );
      expect(rescheduleRes.body.data.slotStart).toContain('T14:00:00.000Z');
    });

    it('should reject rescheduling an appointment owned by another patient', async () => {
      await request(app.getHttpServer())
        .patch(`/appointment/${appointmentId}/reschedule`)
        .set('Authorization', `Bearer ${anotherPatientToken}`)
        .send({
          date: testDate,
          startTime: '11:00',
          endTime: '11:15',
        })
        .expect(HttpStatus.FORBIDDEN);
    });

    it('should reject rescheduling to an already booked slot', async () => {
      // 1. Another patient books 11:20 - 11:35
      await request(app.getHttpServer())
        .post('/appointment')
        .set('Authorization', `Bearer ${anotherPatientToken}`)
        .send({
          doctorId: doctorProfileId,
          date: testDate,
          startTime: '11:20',
          endTime: '11:35',
        })
        .expect(HttpStatus.CREATED);

      // 2. Patient 1 tries to reschedule their appointment to 11:20 - 11:35
      const res = await request(app.getHttpServer())
        .patch(`/appointment/${appointmentId}/reschedule`)
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          date: testDate,
          startTime: '11:20',
          endTime: '11:35',
        })
        .expect(HttpStatus.CONFLICT);

      expect(res.body.message).toContain('already booked');
    });

    it('should reject rescheduling to a slot outside doctor availability', async () => {
      await request(app.getHttpServer())
        .patch(`/appointment/${appointmentId}/reschedule`)
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          date: testDate,
          startTime: '08:00', // doctor starts at 10:00
          endTime: '08:15',
        })
        .expect(HttpStatus.BAD_REQUEST);
    });

    it('should reject rescheduling to a past date or within 30-minute buffer', async () => {
      await request(app.getHttpServer())
        .patch(`/appointment/${appointmentId}/reschedule`)
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          date: '2020-01-01',
          startTime: '11:00',
          endTime: '11:15',
        })
        .expect(HttpStatus.BAD_REQUEST);
    });
  });

  describe('3. Doctor Views & Complete Notes', () => {
    let appointmentId: number;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .get('/doctor/appointments')
        .set('Authorization', `Bearer ${doctorToken}`)
        .expect(HttpStatus.OK);
      appointmentId = res.body.data.appointments[0].id;
    });

    it('should allow doctor to view appointments with pagination, sorting, and filters', async () => {
      const res = await request(app.getHttpServer())
        .get('/doctor/appointments')
        .query({
          status: 'BOOKED',
          sort: 'date',
          page: 1,
          limit: 5,
        })
        .set('Authorization', `Bearer ${doctorToken}`)
        .expect(HttpStatus.OK);

      expect(res.body.success).toBe(true);
      expect(res.body.data.appointments.length).toBeGreaterThan(0);
      expect(res.body.data.pagination.page).toBe(1);
    });

    it('should allow doctor to complete appointment and add diagnosis/prescription notes', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/appointment/${appointmentId}/complete`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          diagnosis: 'Gamma radiation exposure',
          prescription: 'Rest and avoid stress',
          followUp: 'Return in 2 weeks',
        })
        .expect(HttpStatus.OK);

      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Appointment completed successfully');

      // Verify status is COMPLETED
      const details = await request(app.getHttpServer())
        .get(`/appointment/${appointmentId}`)
        .set('Authorization', `Bearer ${patientToken}`)
        .expect(HttpStatus.OK);

      expect(details.body.data.status).toBe('COMPLETED');
      expect(details.body.data.diagnosis).toBe('Gamma radiation exposure');
    });
  });

  describe('4. Cancellation & Cutoff Validation', () => {
    let appointmentId: number;

    beforeAll(async () => {
      // Create a fresh appointment to cancel
      const res = await request(app.getHttpServer())
        .post('/appointment')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          doctorId: doctorProfileId,
          date: testDate,
          startTime: '12:00',
          endTime: '12:15',
        })
        .expect(HttpStatus.CREATED);
      appointmentId = res.body.data.id;
    });

    it('should reject cancelling a completed appointment', async () => {
      // Find the completed one
      const list = await request(app.getHttpServer())
        .get('/appointment/my')
        .set('Authorization', `Bearer ${patientToken}`)
        .expect(HttpStatus.OK);
      const completedApp = list.body.data.find(
        (a: any) => a.status === 'COMPLETED',
      );

      await request(app.getHttpServer())
        .patch(`/appointment/${completedApp.id}/cancel`)
        .set('Authorization', `Bearer ${patientToken}`)
        .expect(HttpStatus.BAD_REQUEST);
    });

    it('should allow patient to cancel a booked appointment', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/appointment/${appointmentId}/cancel`)
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          cancellationReason: 'Going out of town',
        })
        .expect(HttpStatus.OK);

      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Appointment cancelled successfully');
    });

    it('should reject cancelling an already cancelled appointment', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/appointment/${appointmentId}/cancel`)
        .set('Authorization', `Bearer ${patientToken}`)
        .expect(HttpStatus.BAD_REQUEST);

      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('already cancelled');
    });
  });

  describe('5. New Rescheduling & Cutoff & Suggestion Validations', () => {
    it('should reject rescheduling to the exact same slot/time', async () => {
      // 1. Book a stream appointment
      const bookRes = await request(app.getHttpServer())
        .post('/appointment')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          doctorId: doctorProfileId,
          date: testDate,
          startTime: '15:00',
          endTime: '15:15',
        })
        .expect(HttpStatus.CREATED);

      const appId = bookRes.body.data.id;

      // 2. Try to reschedule it to the same slot/time
      const res = await request(app.getHttpServer())
        .patch(`/appointment/${appId}/reschedule`)
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          date: testDate,
          startTime: '15:00',
          endTime: '15:15',
        })
        .expect(HttpStatus.BAD_REQUEST);

      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('already scheduled');
    });

    it('should reject rescheduling an appointment within the 30-minute cutoff window', async () => {
      const patient = await prisma.patientProfile.findFirst({
        where: { user: { email: 'tony@example.com' } },
      });
      const patientId = patient!.id;

      // Create a slot starting 15 minutes from now directly in DB
      const nearFuture = new Date(Date.now() + 15 * 60 * 1000);
      const appRecord = await prisma.appointment.create({
        data: {
          doctorProfileId,
          patientProfileId: patientId,
          appointmentType: 'STREAM',
          slotStart: nearFuture,
          slotEnd: new Date(nearFuture.getTime() + 15 * 60 * 1000),
          status: 'BOOKED',
          bookingSource: 'ONLINE',
        },
      });

      const res = await request(app.getHttpServer())
        .patch(`/appointment/${appRecord.id}/reschedule`)
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          date: testDate,
          startTime: '16:00',
          endTime: '16:15',
        })
        .expect(HttpStatus.BAD_REQUEST);

      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('at least 30 minutes');
    });

    it('should reject cancelling an appointment within the 30-minute cutoff window', async () => {
      const patient = await prisma.patientProfile.findFirst({
        where: { user: { email: 'tony@example.com' } },
      });
      const patientId = patient!.id;

      // Create a slot starting 10 minutes from now directly in DB
      const nearFuture = new Date(Date.now() + 10 * 60 * 1000);
      const appRecord = await prisma.appointment.create({
        data: {
          doctorProfileId,
          patientProfileId: patientId,
          appointmentType: 'STREAM',
          slotStart: nearFuture,
          slotEnd: new Date(nearFuture.getTime() + 15 * 60 * 1000),
          status: 'BOOKED',
          bookingSource: 'ONLINE',
        },
      });

      const res = await request(app.getHttpServer())
        .patch(`/appointment/${appRecord.id}/cancel`)
        .set('Authorization', `Bearer ${patientToken}`)
        .expect(HttpStatus.BAD_REQUEST);

      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('at least 30 minutes');
    });

    it('should suggest next available slot when rescheduling to an already booked slot', async () => {
      // 1. Book slot 15:20-15:35
      const appA = await request(app.getHttpServer())
        .post('/appointment')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          doctorId: doctorProfileId,
          date: testDate,
          startTime: '15:20',
          endTime: '15:35',
        })
        .expect(HttpStatus.CREATED);

      // 2. Book slot 15:40-15:55 (Next available stream slot)
      await request(app.getHttpServer())
        .post('/appointment')
        .set('Authorization', `Bearer ${anotherPatientToken}`)
        .send({
          doctorId: doctorProfileId,
          date: testDate,
          startTime: '15:40',
          endTime: '15:55',
        })
        .expect(HttpStatus.CREATED);

      // 3. Try to reschedule appA to 15:40-15:55 (which is booked)
      const res = await request(app.getHttpServer())
        .patch(`/appointment/${appA.body.data.id}/reschedule`)
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          date: testDate,
          startTime: '15:40',
          endTime: '15:55',
        })
        .expect(HttpStatus.CONFLICT);

      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('already booked');
      expect(res.body.nextAvailable).toBeDefined();
      expect(res.body.nextAvailable.date).toBe(testDate);
    });

    it('should suggest next available wave when booking into a full wave', async () => {
      // 1. Doctor sets scheduling type to WAVE
      await request(app.getHttpServer())
        .patch('/doctor/scheduling')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          type: 'WAVE',
        })
        .expect(HttpStatus.OK);

      // 2. Doctor creates a wave with capacity 1
      const wsStart = new Date(Date.UTC(2031, 8, 20, 10, 0)); // Sept 20, 2031
      const wsEnd = new Date(Date.UTC(2031, 8, 20, 11, 0));
      const wave = await prisma.waveSchedule.create({
        data: {
          doctorProfileId,
          startTime: wsStart,
          endTime: wsEnd,
          maxCapacity: 1,
        },
      });

      // 3. Create another wave later that day as next available
      const nextWaveStart = new Date(Date.UTC(2031, 8, 20, 12, 0));
      const nextWaveEnd = new Date(Date.UTC(2031, 8, 20, 13, 0));
      const wave2 = await prisma.waveSchedule.create({
        data: {
          doctorProfileId,
          startTime: nextWaveStart,
          endTime: nextWaveEnd,
          maxCapacity: 2,
        },
      });

      // 4. Patient 1 books the first wave
      await request(app.getHttpServer())
        .post('/appointment')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({
          doctorId: doctorProfileId,
          waveId: wave.id,
        })
        .expect(HttpStatus.CREATED);

      // 5. Patient 2 tries to book the same wave (now full)
      const res = await request(app.getHttpServer())
        .post('/appointment')
        .set('Authorization', `Bearer ${anotherPatientToken}`)
        .send({
          doctorId: doctorProfileId,
          waveId: wave.id,
        })
        .expect(HttpStatus.CONFLICT);

      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Wave Full');
      expect(res.body.nextAvailable).toBeDefined();
      expect(res.body.nextAvailable.waveId).toBe(wave2.id);
    });
  });
});
