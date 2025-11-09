import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Spaceman } from '../../entities/spaceman.entity';
import { SpacemanRound } from '../../entities/spaceman-round.entity';
import { CreateSpacemanDto } from './dto/create-spaceman.dto';
import { UpdateSpacemanDto } from './dto/update-spaceman.dto';

@Injectable()
export class SpacemanService {
  constructor(
    @InjectRepository(Spaceman)
    private spacemanRepository: Repository<Spaceman>,
    @InjectRepository(SpacemanRound)
    private spacemanRoundRepository: Repository<SpacemanRound>,
  ) {}

  async create(createSpacemanDto: CreateSpacemanDto): Promise<Spaceman> {
    try {
      const spaceman = this.spacemanRepository.create(createSpacemanDto);
      return await this.spacemanRepository.save(spaceman);
    } catch (error) {
      throw new BadRequestException('Error al crear Spaceman: ' + error.message);
    }
  }

  async findAll(): Promise<Spaceman[]> {
    try {
      return await this.spacemanRepository.find({
        relations: ['game', 'bookmaker'],
        order: { created_at: 'DESC' },
      });
    } catch (error) {
      throw new BadRequestException('Error al obtener Spaceman: ' + error.message);
    }
  }

  async findOne(id: number): Promise<Spaceman> {
    try {
      const spaceman = await this.spacemanRepository.findOne({
        where: { id },
        relations: ['rounds', 'game', 'bookmaker'],
      });

      if (!spaceman) {
        throw new NotFoundException(`Spaceman con ID ${id} no encontrado`);
      }

      return spaceman;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException('Error al obtener Spaceman: ' + error.message);
    }
  }

  async findByBookmakerId(bookmakerId: number): Promise<Spaceman | null> {
    try {
      const spaceman = await this.spacemanRepository.findOne({
        where: { bookmakerId },
        relations: ['rounds', 'game', 'bookmaker'],
      });

      return spaceman;
    } catch (error) {
      // Assuming logger is available, otherwise remove this line or import it
      // this.logger.error(`Error al buscar Spaceman por bookmakerId ${bookmakerId}: ${error.message}`);
      return null;
    }
  }

  async update(id: number, updateSpacemanDto: UpdateSpacemanDto): Promise<Spaceman> {
    try {
      const spaceman = await this.findOne(id);
      
      Object.assign(spaceman, updateSpacemanDto);
      return await this.spacemanRepository.save(spaceman);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException('Error al actualizar Spaceman: ' + error.message);
    }
  }

  async remove(id: number): Promise<void> {
    try {
      const spaceman = await this.findOne(id);
      await this.spacemanRepository.remove(spaceman);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException('Error al eliminar Spaceman: ' + error.message);
    }
  }

  async updateWebSocketStatus(bookmakerId: number, status: string): Promise<Spaceman> {
    try {
      const spaceman = await this.findByBookmakerId(bookmakerId);
      if (!spaceman) {
        throw new NotFoundException(`Spaceman no encontrado para bookmaker ID: ${bookmakerId}`);
      }

      spaceman.statusWs = status;
      return await this.spacemanRepository.save(spaceman);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException('Error al actualizar estado del WebSocket: ' + error.message);
    }
  }

  async updateAuthMessageById(id: number, authMessage: string): Promise<Spaceman> {
    try {
      const spaceman = await this.findOne(id);
      spaceman.jsessionid = authMessage;
      return await this.spacemanRepository.save(spaceman);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException('Error al actualizar auth_message (jsessionid): ' + error.message);
    }
  }



  async getRounds(
    spacemanId?: number, 
    limit = 100, 
    offset = 0
  ): Promise<{ rounds: SpacemanRound[]; total: number }> {
    try {
      const whereClause = spacemanId ? { spaceman_id: spacemanId } : {};
      
      const [rounds, total] = await this.spacemanRoundRepository.findAndCount({
        where: whereClause,
        order: { created_at: 'DESC' },
        take: limit,
        skip: offset,
        relations: ['spaceman'],
      });

      return { rounds, total };
    } catch (error) {
      throw new BadRequestException('Error al obtener rondas: ' + error.message);
    }
  }

  async getStats(spacemanId?: number): Promise<any> {
    try {
      const whereClause = spacemanId ? { spaceman_id: spacemanId } : {};
      
      // Estadísticas básicas
      const totalRounds = await this.spacemanRoundRepository.count({ where: whereClause });
      
      const stats = await this.spacemanRoundRepository
        .createQueryBuilder('round')
        .select([
          'COUNT(*) as total_rounds',
          'AVG(round.max_multiplier) as avg_multiplier',
          'MAX(round.max_multiplier) as max_multiplier',
          'MIN(round.max_multiplier) as min_multiplier',
          'SUM(round.total_bet_amount) as total_bets',
          'SUM(round.total_cashout) as total_cashouts',
          'SUM(round.casino_profit) as total_profit',
          'AVG(round.online_player) as avg_players',
          'MAX(round.online_player) as max_players',
        ])
        .where(spacemanId ? 'round.spaceman_id = :spacemanId' : '1=1', { spacemanId })
        .getRawOne();

      // Estadísticas por rangos de multiplicador
      const multiplierRanges = await this.spacemanRoundRepository
        .createQueryBuilder('round')
        .select([
          'CASE ' +
          'WHEN round.max_multiplier < 2 THEN \'< 2x\' ' +
          'WHEN round.max_multiplier < 5 THEN \'2x - 5x\' ' +
          'WHEN round.max_multiplier < 10 THEN \'5x - 10x\' ' +
          'WHEN round.max_multiplier < 50 THEN \'10x - 50x\' ' +
          'ELSE \'> 50x\' ' +
          'END as range',
          'COUNT(*) as count',
          'AVG(round.max_multiplier) as avg_multiplier'
        ])
        .where(spacemanId ? 'round.spaceman_id = :spacemanId' : '1=1', { spacemanId })
        .groupBy('range')
        .orderBy('MIN(round.max_multiplier)')
        .getRawMany();

      // Últimas 24 horas
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      
      const recentStats = await this.spacemanRoundRepository
        .createQueryBuilder('round')
        .select([
          'COUNT(*) as recent_rounds',
          'AVG(round.max_multiplier) as recent_avg_multiplier',
          'SUM(round.total_bet_amount) as recent_total_bets',
          'SUM(round.casino_profit) as recent_total_profit',
        ])
        .where('round.created_at >= :yesterday', { yesterday })
        .andWhere(spacemanId ? 'round.spaceman_id = :spacemanId' : '1=1', { spacemanId })
        .getRawOne();

      return {
        general: {
          total_rounds: parseInt(stats.total_rounds) || 0,
          avg_multiplier: parseFloat(stats.avg_multiplier) || 0,
          max_multiplier: parseFloat(stats.max_multiplier) || 0,
          min_multiplier: parseFloat(stats.min_multiplier) || 0,
          total_bets: parseFloat(stats.total_bets) || 0,
          total_cashouts: parseFloat(stats.total_cashouts) || 0,
          total_profit: parseFloat(stats.total_profit) || 0,
          avg_players: parseFloat(stats.avg_players) || 0,
          max_players: parseInt(stats.max_players) || 0,
        },
        multiplier_distribution: multiplierRanges.map(range => ({
          range: range.range,
          count: parseInt(range.count),
          avg_multiplier: parseFloat(range.avg_multiplier),
          percentage: ((parseInt(range.count) / totalRounds) * 100).toFixed(2),
        })),
        last_24h: {
          rounds: parseInt(recentStats.recent_rounds) || 0,
          avg_multiplier: parseFloat(recentStats.recent_avg_multiplier) || 0,
          total_bets: parseFloat(recentStats.recent_total_bets) || 0,
          total_profit: parseFloat(recentStats.recent_total_profit) || 0,
        },
      };
    } catch (error) {
      throw new BadRequestException('Error al obtener estadísticas: ' + error.message);
    }
  }

  async getLatestRounds(spacemanId: number, limit = 10): Promise<SpacemanRound[]> {
    try {
      return await this.spacemanRoundRepository.find({
        where: { spaceman_id: spacemanId },
        order: { created_at: 'DESC' },
        take: limit,
      });
    } catch (error) {
      throw new BadRequestException('Error al obtener últimas rondas: ' + error.message);
    }
  }
}
