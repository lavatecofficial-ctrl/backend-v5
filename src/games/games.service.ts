import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Game } from '../entities/game.entity';
import { AviatorGateway } from '../gateways/aviator.gateway';
import { RouletteGateway } from '../gateways/roulette.gateway';

@Injectable()
export class GamesService {
  constructor(
    @InjectRepository(Game)
    private gamesRepository: Repository<Game>,
    private aviatorGateway: AviatorGateway,
    private rouletteGateway: RouletteGateway,
  ) {}

  async findAll(): Promise<Game[]> {
    return this.gamesRepository.find({
      where: { is_active: true },
      order: { created_at: 'ASC' },
    });
  }

  async findOne(id: number): Promise<Game | null> {
    return this.gamesRepository.findOne({ where: { id } });
  }

  async create(gameData: Partial<Game>): Promise<Game> {
    const game = this.gamesRepository.create(gameData);
    return this.gamesRepository.save(game);
  }

  async update(id: number, gameData: Partial<Game>): Promise<Game | null> {
    await this.gamesRepository.update(id, gameData);
    return this.findOne(id);
  }

  async remove(id: number): Promise<void> {
    await this.gamesRepository.delete(id);
  }

  async toggleActive(id: number): Promise<Game | null> {
    const game = await this.findOne(id);
    if (game) {
      game.is_active = !game.is_active;
      return this.gamesRepository.save(game);
    }
    throw new Error('Game not found');
  }

  // Métodos para WebSocket
  getAviatorWebSocketStatus() {
    return this.aviatorGateway.getConnectionStats();
  }

  getRouletteWebSocketStatus() {
    return this.rouletteGateway.getConnectionStats();
  }

  cleanupAviatorConnections() {
    return this.aviatorGateway.cleanupOrphanedConnections();
  }

  cleanupRouletteConnections() {
    return this.rouletteGateway.cleanupOrphanedConnections();
  }
}
