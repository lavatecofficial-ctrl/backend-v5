import { IsEmail, IsString, MinLength, IsNotEmpty, Matches } from 'class-validator';

export class RegisterDto {
  @IsString({ message: 'El nombre completo debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'El nombre completo es requerido' })
  @MinLength(2, { message: 'El nombre completo debe tener al menos 2 caracteres' })
  fullName: string;

  @IsEmail({}, { message: 'El email debe ser válido' })
  email: string;

  @IsString({ message: 'La contraseña debe ser una cadena de texto' })
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
  @Matches(/^(?=.*[0-9])(?=.*[!@#$%^&*])/, { 
    message: 'La contraseña debe contener al menos 1 número y 1 símbolo (!@#$%^&*)' 
  })
  password: string;
}
