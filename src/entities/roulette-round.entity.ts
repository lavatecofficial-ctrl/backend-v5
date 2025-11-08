import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Bookmaker } from './bookmaker.entity';

export enum RouletteColor {
  RED = 'Red',
  BLACK = 'Black',
  GREEN = 'Green'
}

export enum RouletteDozen {
  ZERO = 'Zero',
  FIRST = 'First',
  SECOND = 'Second',
  THIRD = 'Third'
}

export enum RouletteColumn {
  ZERO = 'Zero',
  FIRST = 'First',
  SECOND = 'Second',
  THIRD = 'Third'
}

@Entity('roulette_rounds')
export class RouletteRound {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'bookmaker_id' })
  bookmakerId: number;

  @Column({ name: 'round_id' })
  roundId: string;

  @Column()
  number: number;

  @Column({
    type: 'enum',
    enum: RouletteColor
  })
  color: RouletteColor;

  @Column({
    type: 'enum',
    enum: RouletteDozen
  })
  dozen: RouletteDozen;

  @Column({
    type: 'enum',
    enum: RouletteColumn
  })
  column: RouletteColumn;

  @Column({ name: 'timestamp' })
  timestamp: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => Bookmaker)
  @JoinColumn({ name: 'bookmaker_id' })
  bookmaker: Bookmaker;
}
