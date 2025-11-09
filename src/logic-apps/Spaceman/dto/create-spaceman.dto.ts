import { IsNumber, IsNotEmpty, IsOptional, IsString, IsDateString } from 'class-validator';

export class CreateSpacemanDto {
  @IsNumber({}, { message: 'El game_id debe ser un número' })
  @IsNotEmpty({ message: 'El game_id es obligatorio' })
  gameId: number;

  @IsNumber({}, { message: 'El bookmaker_id debe ser un número' })
  @IsNotEmpty({ message: 'El bookmaker_id es obligatorio' })
  bookmakerId: number;

  @IsOptional()
  @IsString({ message: 'El url_sessionid debe ser un string' })
  urlSessionid?: string;

  @IsOptional()
  @IsString({ message: 'El jsessionid debe ser un string' })
  jsessionid?: string;

  @IsOptional()
  @IsString({ message: 'El broadcaster_base debe ser un string' })
  broadcasterBase?: string;

  @IsOptional()
  @IsString({ message: 'El finance_base debe ser un string' })
  financeBase?: string;

  @IsOptional()
  @IsDateString({}, { message: 'El token_updated_at debe ser una fecha válida' })
  tokenUpdatedAt?: string;

  @IsOptional()
  headers?: {
    broadcaster?: Record<string, string>;
    finance?: Record<string, string>;
  };
}
