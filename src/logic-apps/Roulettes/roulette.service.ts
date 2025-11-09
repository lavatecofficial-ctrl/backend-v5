import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RouletteWs } from '../../entities/roulette-ws.entity';

@Injectable()
export class RouletteService {
  constructor(
    @InjectRepository(RouletteWs)
    private rouletteWsRepository: Repository<RouletteWs>,
  ) {}

  async findAll(): Promise<RouletteWs[]> {
    return this.rouletteWsRepository.find({
      relations: ['bookmaker', 'game'],
      order: { id: 'ASC' },
    });
  }

  async findById(id: number): Promise<RouletteWs | null> {
    return this.rouletteWsRepository.findOne({
      where: { id },
      relations: ['bookmaker', 'game'],
    });
  }

  // Edición de page por ID eliminada (solo lectura desde admin)

  async findByBookmakerId(bookmakerId: number): Promise<RouletteWs | null> {
    return this.rouletteWsRepository.findOne({
      where: { bookmakerId },
      relations: ['bookmaker', 'game'],
    });
  }

  async updateWebSocketUrl(bookmakerId: number, url: string): Promise<RouletteWs> {
    const rouletteWs = await this.findByBookmakerId(bookmakerId);
    if (!rouletteWs) {
      throw new Error('Roulette WebSocket no encontrado para este bookmaker');
    }
    
    rouletteWs.page = url;
    return this.rouletteWsRepository.save(rouletteWs);
  }
}
