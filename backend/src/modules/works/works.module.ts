import { Module } from '@nestjs/common';
import { TasksModule } from '../tasks/tasks.module';
import { WorksController } from './works.controller';

@Module({
  imports: [TasksModule],
  controllers: [WorksController],
})
export class WorksModule {}
