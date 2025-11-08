import { PartialType } from '@nestjs/mapped-types';
import { CreateSpacemanDto } from './create-spaceman.dto';

export class UpdateSpacemanDto extends PartialType(CreateSpacemanDto) {}
