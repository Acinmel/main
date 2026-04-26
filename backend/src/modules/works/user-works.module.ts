import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { UserWorksPersistenceService } from './user-works-persistence.service';

@Module({
  imports: [DatabaseModule],
  providers: [UserWorksPersistenceService],
  exports: [UserWorksPersistenceService],
})
export class UserWorksModule {}
