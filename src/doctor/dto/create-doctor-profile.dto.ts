import { IsNotEmpty, IsInt, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateDoctorProfileDto {
  @IsNotEmpty({ message: 'Full Name is required' })
  @IsString()
  fullName: string;

  @IsNotEmpty({ message: 'Specialization is required' })
  @IsString()
  specialization: string;

  @IsNotEmpty({ message: 'Experience is required' })
  @IsInt({ message: 'Experience must be an integer' })
  experience: number;

  @IsNotEmpty({ message: 'Qualification is required' })
  @IsString()
  qualification: string;

  @IsNotEmpty({ message: 'Consultation Fee is required' })
  @IsNumber({}, { message: 'Consultation Fee must be a number' })
  consultationFee: number;

  @IsNotEmpty({ message: 'Availability is required' })
  @IsString()
  availability: string;

  @IsOptional()
  @IsString()
  profileDetails?: string;
}
