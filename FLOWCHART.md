# Doctor Scheduling Flow Charts

## Stream Scheduling Flow
```
Doctor sets scheduling type
           │
           ▼
  schedulingType = STREAM
           │
           ▼
Doctor sets availability
  (dayOfWeek, startTime, endTime,
   slotDuration, bufferTime)
           │
           ▼
POST /doctor/availability/:id/generate?date=YYYY-MM-DD
           │
           ▼
System generates exact slots
  ┌─────────────────────────────┐
  │ 10:00 – 10:15  (slot 1)    │
  │ 10:20 – 10:35  (slot 2)    │
  │ 10:40 – 10:55  (slot 3)    │
  └─────────────────────────────┘
           │
           ▼
Patient fetches availability
GET /patient/availability/:doctorId?date=YYYY-MM-DD
           │
           ▼
Patient sees exact time slots
  ┌──────────────────────────────────┐
  │ Slot 1: 10:00–10:15  Available  │
  │ Slot 2: 10:20–10:35  Available  │
  │ Slot 3: 10:40–10:55  Booked     │
  └──────────────────────────────────┘
           │
           ▼
Patient books a slot
POST /patient/availability/book/stream
  { streamSlotId, doctorId }
           │
           ▼
  ┌─────────────────────────┐
  │ Slot already booked?    │
  │ YES → 409 Conflict      │
  │ NO  → Booking confirmed │
  └─────────────────────────┘
           │
           ▼
Patient gets exact appointment time
  {
    appointmentTime: "10:00 – 10:15"
  }
```

---

## Wave Scheduling Flow
```
Doctor sets scheduling type
           │
           ▼
  schedulingType = WAVE
           │
           ▼
Doctor sets availability
  (dayOfWeek, startTime, endTime,
   maxCapacity)
           │
           ▼
POST /doctor/availability/:id/generate?date=YYYY-MM-DD
           │
           ▼
System creates one wave window
  ┌─────────────────────────────┐
  │ 10:00 – 11:00               │
  │ maxPatients: 5              │
  │ bookedCount: 0              │
  │ available: 5/5              │
  └─────────────────────────────┘
           │
           ▼
Patient fetches availability
GET /patient/availability/:doctorId?date=YYYY-MM-DD
           │
           ▼
Patient sees wave window
  ┌──────────────────────────────┐
  │ Time Window: 10:00 – 11:00  │
  │ Available: 3/5              │
  └──────────────────────────────┘
           │
           ▼
Patient books into wave
POST /patient/availability/book/wave
  { waveId, doctorId }
           │
           ▼
  ┌──────────────────────────────┐
  │ Wave full?                   │
  │ YES → 409 Conflict           │
  │       "Wave is full"         │
  │ NO  → Assign token number    │
  │       tokenNumber = count+1  │
  └──────────────────────────────┘
           │
           ▼
Patient gets token number
  {
    timeWindow: "10:00 – 11:00",
    tokenNumber: 3
  }
```

---

## Summary

| Feature | STREAM | WAVE |
|---------|--------|------|
| Appointment type | Exact time slot | Time window |
| Patient gets | 10:00 – 10:15 | Token No: 3 |
| Config needed | slotDuration, bufferTime | maxCapacity |
| Use case | Specialists, detailed consult | OPD, high volume |
| Overbooking | Not possible (slot marked booked) | Not possible (capacity check) |
| Token | Not applicable | Sequential (1, 2, 3...) |

---

## Elastic Scheduling Entity & Flow Diagrams

### Entity Relationship Diagram (ERD)

```mermaid
erDiagram
    Doctor ||--o{ DoctorAvailability : "defines availability"
    DoctorAvailability ||--o{ AppointmentSlot : "generates slots"
    Doctor ||--o{ AppointmentSlot : "manages slots"
    AppointmentSlot |o--o| Appointment : "reserved by"
    Doctor ||--o{ Appointment : "attends"
    Patient ||--o{ Appointment : "books"

    Doctor {
        int id PK
        string name
        string consultation
    }

    DoctorAvailability {
        int id PK
        int doctorId FK
        string date_or_day
        string startTime
        string endTime
        int duration
        string schedulingType "ELASTIC"
    }

    AppointmentSlot {
        int id PK
        int availabilityId FK
        int doctorId FK
        datetime slotStart
        datetime slotEnd
        string status "AVAILABLE | BOOKED"
    }

    Appointment {
        int id PK
        int patientId FK
        int doctorId FK
        int slotId FK "References AppointmentSlot"
        string status "CONFIRMED | CANCELLED"
    }

    Patient {
        int id PK
        string name
        string contact
    }
```

### Elastic Scheduling (Expand & Shrink) Flow Diagram

```mermaid
flowchart TD
    classDef entity fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px;
    classDef process fill:#e1f5fe,stroke:#0288d1,stroke-width:1px;
    classDef decision fill:#fff9c4,stroke:#fbc02d,stroke-width:1px;
    classDef error fill:#ffebee,stroke:#c62828,stroke-width:1px;

    %% Request Input
    Request([PATCH /doctor/availability])
    
    %% Entity Definitions & Flow
    Request --> AvailabilityEntity["DoctorAvailability Entity<br/>(startTime, endTime, duration)"]:::entity
    
    AvailabilityEntity --> DetermineAction{"Change Direction?"}:::decision
    
    %% Expand Path
    DetermineAction -->|Expand: newEndTime > oldEndTime| ExpandTime["Identify New Window:<br/>(oldEndTime to newEndTime)"]:::process
    ExpandTime --> GenerateSlots["Generate new AppointmentSlot Entities<br/>(status = AVAILABLE)"]:::process
    GenerateSlots --> SaveSlots[("Save AppointmentSlot Entities to DB")]:::entity

    %% Shrink Path
    DetermineAction -->|Shrink: newEndTime < oldEndTime| FindSlots["Query existing AppointmentSlot Entities<br/>(slotStart >= newEndTime)"]:::process
    FindSlots --> CheckBooked{"Any slots have<br/>status = BOOKED?"}:::decision
    
    %% Decision handling
    CheckBooked -->|Yes| FetchAppt["Look up related Appointment Entity<br/>(status = CONFIRMED)"]:::process
    FetchAppt --> FailUpdate["Transaction Rollback:<br/>Reject Request & Return Error"]:::error
    
    CheckBooked -->|No| DeleteSlots["Delete unbooked AppointmentSlot Entities<br/>(status = AVAILABLE)"]:::process
    DeleteSlots --> UpdateAvailability[("Save DoctorAvailability Entity to DB")]:::entity
```

### 2D Graphical Architecture Diagram

![Elastic Scheduling 2D Architecture Diagram](file:///C:/Users/chauh/.gemini/antigravity-ide/brain/e6ebfbee-cba1-4a6e-a018-c39637fd9c22/elastic_scheduling_diagram_1785769934068.png)

