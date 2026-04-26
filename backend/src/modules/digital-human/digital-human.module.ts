import { Module } from '@nestjs/common';
import { DigitalHumanPersistenceService } from './digital-human-persistence.service';

@Module({
  providers: [DigitalHumanPersistenceService],
  exports: [DigitalHumanPersistenceService],
})
export class DigitalHumanModule {}
