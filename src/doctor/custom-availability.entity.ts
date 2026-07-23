export class CustomAvailability {
  id: number;
  doctorProfileId: number;
  date: Date;
  startTime: string | null;
  endTime: string | null;
  isAvailable: boolean;
  createdAt: Date;
  updatedAt: Date;
}
