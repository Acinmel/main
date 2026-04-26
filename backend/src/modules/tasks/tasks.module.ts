import { Module } from '@nestjs/common';
import { AiModule } from '../../integrations/ai/ai.module';
import { DigitalHumanModule } from '../digital-human/digital-human.module';
import { UserWorksModule } from '../works/user-works.module';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [AiModule, UserWorksModule, DigitalHumanModule],
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
