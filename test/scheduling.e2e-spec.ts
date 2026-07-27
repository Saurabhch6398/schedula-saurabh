/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unused-vars */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
import request from 'supertest';

import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Advanced Scheduling System (e2e)', () => {
  jest.setTimeout(30000);

  let app: INestApplication<App>;
  let prisma: PrismaService;

  let doctorToken: string;
  let patient1Token: string;
  let patient2Token: string;
  let patient3Token: string;

  let doctorProfileId: number;
  let patient1ProfileId: number;

  const testDate = '2030-08-20'; // A date far in the future to avoid "past slot" issues

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);

    // Teardown database in correct dependency order
    await prisma.appointment.deleteMany({});
    await prisma.waveSchedule.deleteMany({});
    await prisma.recurringAvailability.deleteMany({});
    await prisma.customAvailability.deleteMany({});
    await prisma.doctorProfile.deleteMany({});
    await prisma.patientProfile.deleteMany({});
    await prisma.user.deleteMany({});

    // 1. Sign up and login Doctor
    await request(app.getHttpServer())
      .post('/signup')
      .send({
        name: 'Doctor Strange',
        email: 'doctor@example.com',
        password: 'password123',
        role: 'DOCTOR',
      })
      .expect(HttpStatus.CREATED);

    const docLogin = await request(app.getHttpServer())
      .post('/login')
      .send({
        email: 'doctor@example.com',
        password: 'password123',
      })
      .expect(HttpStatus.OK);
    doctorToken = docLogin.body.token;

    // Create doctor profile
    const docProfile = await request(app.getHttpServer())
      .post('/doctor/profile')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({
        fullName: 'Doctor Strange',
        specialization: 'Neurology',
        experience: 15,
        qualification: 'MD',
        consultationFee: 200,
        availability: 'Mon-Fri 10AM-5PM',
      })
      .expect(HttpStatus.CREATED);

    // Fetch the doctor profile to get ID
    const docProfileDetails = await request(app.getHttpServer())
      .get('/doctor/profile')
      .set('Authorization', `Bearer ${doctorToken}`)
      .expect(HttpStatus.OK);
    doctorProfileId = docProfileDetails.body.id;

    // 2. Sign up and login Patient 1
    await request(app.getHttpServer())
      .post('/signup')
      .send({
        name: 'Peter Parker',
        email: 'patient1@example.com',
        password: 'password123',
        role: 'PATIENT',
      })
      .expect(HttpStatus.CREATED);

    const p1Login = await request(app.getHttpServer())
      .post('/login')
      .send({
        email: 'patient1@example.com',
        password: 'password123',
      })
      .expect(HttpStatus.OK);
    patient1Token = p1Login.body.token;

    // Create patient 1 profile
    await request(app.getHttpServer())
      .post('/patient/profile')
      .set('Authorization', `Bearer ${patient1Token}`)
      .send({
        fullName: 'Peter Parker',
        age: 20,
        gender: 'Male',
        contact: '1234567890',
        healthInfo: 'No issues',
      })
      .expect(HttpStatus.CREATED);

    // 3. Sign up and login Patient 2
    await request(app.getHttpServer())
      .post('/signup')
      .send({
        name: 'Mary Jane',
        email: 'patient2@example.com',
        password: 'password123',
        role: 'PATIENT',
      })
      .expect(HttpStatus.CREATED);

    const p2Login = await request(app.getHttpServer())
      .post('/login')
      .send({
        email: 'patient2@example.com',
        password: 'password123',
      })
      .expect(HttpStatus.OK);
    patient2Token = p2Login.body.token;

    // Create patient 2 profile
    await request(app.getHttpServer())
      .post('/patient/profile')
      .set('Authorization', `Bearer ${patient2Token}`)
      .send({
        fullName: 'Mary Jane',
        age: 20,
        gender: 'Female',
        contact: '0987654321',
      })
      .expect(HttpStatus.CREATED);

    // 4. Sign up and login Patient 3
    await request(app.getHttpServer())
      .post('/signup')
      .send({
        name: 'Harry Osborn',
        email: 'patient3@example.com',
        password: 'password123',
        role: 'PATIENT',
      })
      .expect(HttpStatus.CREATED);

    const p3Login = await request(app.getHttpServer())
      .post('/login')
      .send({
        email: 'patient3@example.com',
        password: 'password123',
      })
      .expect(HttpStatus.OK);
    patient3Token = p3Login.body.token;

    // Create patient 3 profile
    await request(app.getHttpServer())
      .post('/patient/profile')
      .set('Authorization', `Bearer ${patient3Token}`)
      .send({
        fullName: 'Harry Osborn',
        age: 22,
        gender: 'Male',
        contact: '1122334455',
      })
      .expect(HttpStatus.CREATED);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. Scheduling Type Selection & Configuration Validation', () => {
    it('should validate STREAM scheduling configuration (invalid slot duration)', async () => {
      const res = await request(app.getHttpServer())
        .patch('/doctor/scheduling')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          type: 'STREAM',
          slotDuration: 0,
          bufferTime: 5,
        })
        .expect(HttpStatus.BAD_REQUEST);

      expect(res.body.message).toBe('Invalid slot duration');
    });

    it('should validate STREAM scheduling configuration (invalid negative buffer)', async () => {
      const res = await request(app.getHttpServer())
        .patch('/doctor/scheduling')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          type: 'STREAM',
          slotDuration: 15,
          bufferTime: -5,
        })
        .expect(HttpStatus.BAD_REQUEST);

      expect(res.body.message).toBe('Invalid buffer time');
    });

    it('should successfully select STREAM scheduling type', async () => {
      await request(app.getHttpServer())
        .patch('/doctor/scheduling')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          type: 'STREAM',
          slotDuration: 15,
          bufferTime: 5,
        })
        .expect(HttpStatus.OK);

      const profile = await prisma.doctorProfile.findUnique({
        where: { id: doctorProfileId },
      });
      expect(profile).not.toBeNull();
      expect(profile!.schedulingType).toBe('STREAM');
      expect(profile!.slotDuration).toBe(15);
      expect(profile!.bufferTime).toBe(5);
    });
  });

  describe('2. STREAM Scheduling Flow', () => {
    beforeAll(async () => {
      // Ensure doctor is STREAM
      await prisma.doctorProfile.update({
        where: { id: doctorProfileId },
        data: {
          schedulingType: 'STREAM',
          slotDuration: 15,
          bufferTime: 5,
        },
      });

      // Clear doctor's availabilities and appointments
      await prisma.appointment.deleteMany({});
      await prisma.recurringAvailability.deleteMany({});
      await prisma.customAvailability.deleteMany({});
    });

    it('should create recurring availability for doctor', async () => {
      const res = await request(app.getHttpServer())
        .post('/doctor/availability')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          dayOfWeek: 'TUESDAY', // Let's check Tuesday since Aug 20, 2030 is Tuesday
          startTime: '10:00',
          endTime: '11:00',
        })
        .expect(HttpStatus.CREATED);

      expect(res.body.message).toBe('Availability added successfully');
    });

    it('should generate STREAM slots correctly, excluding past slots', async () => {
      const res = await request(app.getHttpServer())
        .get(`/doctor/${doctorProfileId}/slots`)
        .query({ date: testDate })
        .set('Authorization', `Bearer ${patient1Token}`)
        .expect(HttpStatus.OK);

      // 10:00 to 11:00, duration 15, buffer 5:
      // Slot 1: 10:00 - 10:15
      // Slot 2: 10:20 - 10:35
      // Slot 3: 10:40 - 10:55
      expect(res.body.length).toBe(3);
      expect(res.body[0].slot).toBe('10:00-10:15');
      expect(res.body[1].slot).toBe('10:20-10:35');
      expect(res.body[2].slot).toBe('10:40-10:55');
    });

    it('should prevent booking slot in the past', async () => {
      await request(app.getHttpServer())
        .post('/appointments')
        .set('Authorization', `Bearer ${patient1Token}`)
        .send({
          doctorId: doctorProfileId,
          slot: '10:00',
          date: '2020-01-01',
        })
        .expect(HttpStatus.BAD_REQUEST);
    });

    it('should book stream slot successfully', async () => {
      const res = await request(app.getHttpServer())
        .post('/appointments')
        .set('Authorization', `Bearer ${patient1Token}`)
        .send({
          doctorId: doctorProfileId,
          slot: '10:20',
          date: testDate,
        })
        .expect(HttpStatus.CREATED);

      expect(res.body.appointmentType).toBe('STREAM');
      expect(res.body.doctorId).toBe(doctorProfileId);

      // Verify slot is removed/unavailable in subsequent fetches
      const slotsRes = await request(app.getHttpServer())
        .get(`/doctor/${doctorProfileId}/slots`)
        .query({ date: testDate })
        .set('Authorization', `Bearer ${patient1Token}`)
        .expect(HttpStatus.OK);

      // Should now only return slot 1 and slot 3
      expect(slotsRes.body.length).toBe(2);
      expect(slotsRes.body.map((s) => s.slot)).not.toContain('10:20-10:35');
    });

    it('should prevent booking duplicate/same slot again', async () => {
      await request(app.getHttpServer())
        .post('/appointments')
        .set('Authorization', `Bearer ${patient1Token}`)
        .send({
          doctorId: doctorProfileId,
          slot: '10:20',
          date: testDate,
        })
        .expect(HttpStatus.CONFLICT);
    });
  });

  describe('3. WAVE Scheduling Flow', () => {
    let waveScheduleId: number;

    beforeAll(async () => {
      // 1. Select WAVE scheduling type for doctor
      await request(app.getHttpServer())
        .patch('/doctor/scheduling')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          type: 'WAVE',
        })
        .expect(HttpStatus.OK);

      // Clear doctor's availabilities and appointments
      await prisma.appointment.deleteMany({});
      await prisma.waveSchedule.deleteMany({});
    });

    it('should reject creating WAVE availability with invalid capacity', async () => {
      await request(app.getHttpServer())
        .post('/doctor/availability')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          date: testDate,
          startTime: '10:00',
          endTime: '11:00',
          maxCapacity: 0,
        })
        .expect(HttpStatus.BAD_REQUEST);
    });

    it('should create WAVE availability (WaveSchedule) successfully', async () => {
      await request(app.getHttpServer())
        .post('/doctor/availability')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          date: testDate,
          startTime: '10:00',
          endTime: '11:00',
          maxCapacity: 2, // Low capacity to test full limit
        })
        .expect(HttpStatus.CREATED);

      // Fetch waves
      const wavesRes = await request(app.getHttpServer())
        .get(`/doctor/${doctorProfileId}/waves`)
        .query({ date: testDate })
        .set('Authorization', `Bearer ${patient1Token}`)
        .expect(HttpStatus.OK);

      expect(wavesRes.body.length).toBe(1);
      expect(wavesRes.body[0].window).toBe('10AM-11AM');
      expect(wavesRes.body[0].available).toBe('2/2');
      waveScheduleId = wavesRes.body[0].id;
    });

    it('should reject creating overlapping wave schedule', async () => {
      await request(app.getHttpServer())
        .post('/doctor/availability')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          date: testDate,
          startTime: '10:30',
          endTime: '11:30',
          maxCapacity: 5,
        })
        .expect(HttpStatus.CONFLICT);
    });

    it('should assign sequential token numbers to bookings', async () => {
      // Patient 1 books
      const res1 = await request(app.getHttpServer())
        .post('/appointments')
        .set('Authorization', `Bearer ${patient1Token}`)
        .send({
          doctorId: doctorProfileId,
          waveId: waveScheduleId,
        })
        .expect(HttpStatus.CREATED);

      expect(res1.body.appointmentWindow).toBe('10AM-11AM');
      expect(res1.body.tokenNumber).toBe(1);

      // Patient 2 books
      const res2 = await request(app.getHttpServer())
        .post('/appointments')
        .set('Authorization', `Bearer ${patient2Token}`)
        .send({
          doctorId: doctorProfileId,
          waveId: waveScheduleId,
        })
        .expect(HttpStatus.CREATED);

      expect(res2.body.appointmentWindow).toBe('10AM-11AM');
      expect(res2.body.tokenNumber).toBe(2);

      // Verify availability is updated
      const wavesRes = await request(app.getHttpServer())
        .get(`/doctor/${doctorProfileId}/waves`)
        .query({ date: testDate })
        .set('Authorization', `Bearer ${patient1Token}`)
        .expect(HttpStatus.OK);

      expect(wavesRes.body[0].available).toBe('0/2');
    });

    it('should reject duplicate booking by same patient in same wave', async () => {
      await request(app.getHttpServer())
        .post('/appointments')
        .set('Authorization', `Bearer ${patient1Token}`)
        .send({
          doctorId: doctorProfileId,
          waveId: waveScheduleId,
        })
        .expect(HttpStatus.CONFLICT);
    });

    it('should prevent booking when capacity is full (overbooking)', async () => {
      const res = await request(app.getHttpServer())
        .post('/appointments')
        .set('Authorization', `Bearer ${patient3Token}`)
        .send({
          doctorId: doctorProfileId,
          waveId: waveScheduleId,
        })
        .expect(HttpStatus.CONFLICT);

      expect(res.body.message).toBe('Wave Full');
    });
  });
});
