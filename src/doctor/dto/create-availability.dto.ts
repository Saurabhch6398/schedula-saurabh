import { IsNotEmpty, IsString, IsIn, IsOptional, IsInt } from 'class-validator';

export class CreateAvailabilityDto {
  @IsOptional()
  @IsString()
  @IsIn(
    [
      'MONDAY',
      'TUESDAY',
      'WEDNESDAY',
      'THURSDAY',
      'FRIDAY',
      'SATURDAY',
      'SUNDAY',
    ],
    { message: 'dayOfWeek must be a valid uppercase day of the week' },
  )
  dayOfWeek?: string;

  @IsNotEmpty({ message: 'Start time is required' })
  @IsString()
  startTime: string;

  @IsNotEmpty({ message: 'End time is required' })
  @IsString()
  endTime: string;

  @IsOptional()
  @IsString()
  date?: string;

  @IsOptional()
  @IsInt({ message: 'maxCapacity must be an integer' })
  maxCapacity?: number;
}
