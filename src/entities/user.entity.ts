import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, nullable: false })
  fullName: string;

  @Column({ type: 'varchar', length: 255, unique: true, nullable: false })
  email: string;

  @Column({ type: 'varchar', length: 255, nullable: false })
  password: string;

  @Column({ type: 'boolean', default: false })
  isEmailVerified: boolean;

  @Column({ type: 'timestamp', nullable: true })
  lastLoginAt: Date;

  @Column({ type: 'varchar', length: 6, nullable: true })
  resetCode: string | null;

  @Column({ type: 'timestamp', nullable: true })
  resetCodeExpiresAt: Date | null;

  @Column({ type: 'boolean', default: false })
  resetCodeUsed: boolean;

  @Column({ 
    type: 'enum', 
    enum: ['user', 'admin', 'superadmin'], 
    default: 'user' 
  })
  role: 'user' | 'admin' | 'superadmin';

  @Column({ type: 'timestamp', nullable: true })
  planStartDate: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  planEndDate: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  googleId: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  facebookId: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  profilePicture: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
