import { IsOptional, IsDateString, IsUUID } from 'class-validator';

export class UpdateUserPlanDto {
  @IsUUID(4, { message: 'ID de usuario debe ser un UUID válido' })
  userId: string;

  @IsOptional()
  @IsDateString({}, { message: 'Fecha de inicio debe ser una fecha válida' })
  planStartDate: string | null;

  @IsOptional()
  @IsDateString({}, { message: 'Fecha de fin debe ser una fecha válida' })
  planEndDate: string | null;
}
