import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Spaceman } from './spaceman.entity';

@Entity('spaceman_rounds')
@Index(['game_id'], { unique: true })
export class SpacemanRound {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255, unique: true })
  game_id: string;

  @Column({ type: 'integer', nullable: true })
  bets_count: number | null;

  @Column({ type: 'double precision', nullable: true })
  total_bet_amount: number | null;

  @Column({ type: 'integer', nullable: true })
  online_player: number | null;

  @Column({ type: 'double precision', nullable: true })
  max_multiplier: number | null;

  @Column({ type: 'double precision', nullable: true })
  total_cashout: number | null;

  @Column({ type: 'double precision', nullable: true })
  casino_profit: number | null;

  @Column({ type: 'integer', nullable: true })
  spaceman_id: number | null;

  @CreateDateColumn()
  created_at: Date;

  @ManyToOne(() => Spaceman, spaceman => spaceman.rounds)
  @JoinColumn({ name: 'spaceman_id' })
  spaceman: Spaceman;
}
