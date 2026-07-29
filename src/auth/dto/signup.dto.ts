import { IsEmail, IsIn, IsNotEmpty, MinLength } from 'class-validator';

export class SignupDto {
  @IsNotEmpty({ message: 'Name is required' })
  name: string;

  @IsEmail({}, { message: 'Invalid email address' })
  email: string;

  @IsNotEmpty({ message: 'Password is required' })
  @MinLength(6, { message: 'Password must be at least 6 characters long' })
  password: string;

  @IsNotEmpty({ message: 'Role is required' })
  @IsIn(['DOCTOR', 'PATIENT'], {
    message: 'Role must be either DOCTOR or PATIENT',
  })
  role: 'DOCTOR' | 'PATIENT';
}
