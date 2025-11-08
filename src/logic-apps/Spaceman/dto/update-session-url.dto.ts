import { IsString, IsNotEmpty } from 'class-validator';

export class UpdateSessionUrlDto {
  @IsString({ message: 'La URL debe ser un string' })
  @IsNotEmpty({ message: 'La URL es obligatoria' })
  url: string;
}
