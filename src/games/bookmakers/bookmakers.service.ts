import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Bookmaker } from '../../entities/bookmaker.entity';

@Injectable()
export class BookmakersService {
  constructor(
    @InjectRepository(Bookmaker)
    private bookmakersRepository: Repository<Bookmaker>,
  ) {}

  async findAll(): Promise<Bookmaker[]> {
    return this.bookmakersRepository.find({
      relations: ['game'],
    });
  }

  async findByGameId(gameId: number): Promise<Bookmaker[]> {
    return this.bookmakersRepository.find({
      where: { gameId },
      relations: ['game'],
    });
  }

  async findOne(id: number): Promise<Bookmaker | null> {
    return this.bookmakersRepository.findOne({
      where: { id },
      relations: ['game'],
    });
  }

  async create(createBookmakerDto: {
    gameId: number;
    bookmaker: string;
    bookmakerImg: string;
  }): Promise<Bookmaker> {
    const bookmaker = this.bookmakersRepository.create(createBookmakerDto);
    return this.bookmakersRepository.save(bookmaker);
  }

  async update(
    id: number,
    updateBookmakerDto: {
      gameId?: number;
      bookmaker?: string;
      bookmakerImg?: string;
    },
  ): Promise<Bookmaker | null> {
    await this.bookmakersRepository.update(id, updateBookmakerDto);
    return this.findOne(id);
  }

  async remove(id: number): Promise<void> {
    await this.bookmakersRepository.delete(id);
  }
}
