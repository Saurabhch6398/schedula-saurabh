import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CompleteAppointmentDto {
  @IsNotEmpty({ message: 'Diagnosis is required' })
  @IsString()
  diagnosis: string;

  @IsNotEmpty({ message: 'Prescription is required' })
  @IsString()
  prescription: string;

  @IsOptional()
  @IsString()
  followUp?: string;
}
