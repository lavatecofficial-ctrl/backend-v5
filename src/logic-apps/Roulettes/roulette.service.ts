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
