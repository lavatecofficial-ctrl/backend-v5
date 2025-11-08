import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { Game } from './game.entity';

@Entity('bookmakers')
export class Bookmaker {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'game_id' })
  gameId: number;

  @Column({ type: 'varchar', length: 100 })
  bookmaker: string;

  @Column({ name: 'bookmaker_img', type: 'varchar', length: 255 })
  bookmakerImg: string;

  @Column({ name: 'scale_img', type: 'int', default: 65 })
  scaleImg: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => Game, game => game.id)
  @JoinColumn({ name: 'game_id' })
  game: Game;
}
