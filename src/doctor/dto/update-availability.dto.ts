import { IsString, IsIn, IsOptional, IsInt } from 'class-validator';

export class UpdateAvailabilityDto {
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

  @IsOptional()
  @IsString()
  startTime?: string;

  @IsOptional()
  @IsString()
  endTime?: string;

  @IsOptional()
  @IsInt({ message: 'maxCapacity must be an integer' })
  maxCapacity?: number;
}
