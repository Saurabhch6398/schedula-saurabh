import { IsNotEmpty, IsInt, IsOptional, IsString } from 'class-validator';

export class CreatePatientProfileDto {
  @IsNotEmpty({ message: 'Full Name is required' })
  @IsString()
  fullName: string;

  @IsNotEmpty({ message: 'Age is required' })
  @IsInt({ message: 'Age must be an integer' })
  age: number;

  @IsNotEmpty({ message: 'Gender is required' })
  @IsString()
  gender: string;

  @IsNotEmpty({ message: 'Contact is required' })
  @IsString()
  contact: string;

  @IsOptional()
  @IsString()
  healthInfo?: string;
}
