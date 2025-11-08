import { IsEmail, IsNotEmpty, IsString, Length, MinLength, Matches } from 'class-validator';

export class RequestPasswordResetDto {
  @IsEmail({}, { message: 'Email debe ser válido' })
  @IsNotEmpty({ message: 'Email es obligatorio' })
  email: string;
}

export class VerifyCodeOnlyDto {
  @IsEmail({}, { message: 'Email debe ser válido' })
  @IsNotEmpty({ message: 'Email es obligatorio' })
  email: string;

  @IsString({ message: 'Código debe ser texto' })
  @Length(6, 6, { message: 'Código debe tener exactamente 6 dígitos' })
  code: string;
}

export class VerifyResetCodeDto {
  @IsEmail({}, { message: 'Email debe ser válido' })
  @IsNotEmpty({ message: 'Email es obligatorio' })
  email: string;

  @IsString({ message: 'Código debe ser texto' })
  @Length(6, 6, { message: 'Código debe tener exactamente 6 dígitos' })
  code: string;

  @IsString({ message: 'Nueva contraseña es obligatoria' })
  @MinLength(8, { message: 'Nueva contraseña debe tener al menos 8 caracteres' })
  @Matches(/^(?=.*[0-9])(?=.*[!@#$%^&*])/, { 
    message: 'Nueva contraseña debe contener al menos 1 número y 1 símbolo (!@#$%^&*)' 
  })
  new_password: string;
}
