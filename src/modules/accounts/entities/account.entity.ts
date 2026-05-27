import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { AccountStatus } from '../enums/account-status.enum.js';

@Entity('accounts')
export class Account {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 56, unique: true })
  @Index()
  publicKey: string;

  @Column({ type: 'text' })
  secretKeyEncrypted: string;

  @Column({ type: 'varchar', length: 56 })
  fundingSource: string;

  @Column({ type: 'decimal', precision: 18, scale: 7 })
  amount: string;

  @Column({ type: 'varchar', length: 100 })
  asset: string;

  @Column({
    type: 'enum',
    enum: AccountStatus,
    default: AccountStatus.PENDING_PAYMENT,
  })
  @Index()
  status: AccountStatus;

  @Column({ type: 'varchar', length: 64, nullable: true })
  @Index()
  claimTokenHash: string;

  @Column({ type: 'varchar', length: 56, nullable: true })
  destinationAddress: string;

  @Column({ type: 'timestamp' })
  @Index()
  expiresAt: Date; // Scheduled expiry time - set on creation, used by the expiry scheduler

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  claimedAt: Date | null;

  // Then wherever your expiry flow sets account status to EXPIRED (likely in the sweeps or a scheduler module once built), ensure this is also set:
  // account.status = AccountStatus.EXPIRED;
  // account.expiredAt = new Date();
  // await this.accountsRepository.save(account);
  @Column({ type: 'timestamp', nullable: true })
  expiredAt: Date | null; // Actual time expiry was processed - set by the expiry handler, null until then

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;
}
