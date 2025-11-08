import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Bookmaker } from './bookmaker.entity';

@Entity('aviator_rounds')
export class AviatorRound {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'bookmaker_id' })
  bookmakerId: number;

  @Column({ name: 'round_id', type: 'varchar', length: 100 })
  roundId: string;

  @Column({ name: 'bets_count', type: 'int', default: 0 })
  betsCount: number;

  @Column({ name: 'total_bet_amount', type: 'decimal', precision: 15, scale: 2, default: 0 })
  totalBetAmount: number;

  @Column({ name: 'online_players', type: 'int', default: 0 })
  onlinePlayers: number;

  @Column({ name: 'max_multiplier', type: 'decimal', precision: 10, scale: 2, default: 0 })
  maxMultiplier: number;

  @Column({ name: 'total_cashout', type: 'decimal', precision: 15, scale: 2, default: 0 })
  totalCashout: number;

  @Column({ name: 'casino_profit', type: 'decimal', precision: 15, scale: 2, default: 0 })
  casinoProfit: number;

  @Column({ name: 'loss_percentage', type: 'decimal', precision: 5, scale: 2, default: 0 })
  lossPercentage: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => Bookmaker, bookmaker => bookmaker.id)
  @JoinColumn({ name: 'bookmaker_id' })
  bookmaker: Bookmaker;
}
