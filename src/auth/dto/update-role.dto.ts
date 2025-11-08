import { IsEmail, IsEnum, IsNotEmpty } from 'class-validator';

export class UpdateRoleDto {
  @IsEmail({}, { message: 'Email debe ser válido' })
  @IsNotEmpty({ message: 'Email es obligatorio' })
  email: string;

  @IsEnum(['user', 'admin', 'superadmin'], { 
    message: 'Rol debe ser user, admin o superadmin' 
  })
  role: 'user' | 'admin' | 'superadmin';
}
