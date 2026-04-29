import './load-env';
import { existsSync } from 'fs';
import { join } from 'path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TasksModule } from './modules/tasks/tasks.module';
import { ToolsModule } from './modules/tools/tools.module';
import { WorksModule } from './modules/works/works.module';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard';

const inDocker = existsSync('/.dockerenv');
const rootEnvPath = join(__dirname, '..', '..', '.env');
const backendEnvPath = join(__dirname, '..', '.env');
const envFilePath = [
  ...(inDocker && existsSync(rootEnvPath) ? [rootEnvPath] : []),
  ...(existsSync(backendEnvPath) ? [backendEnvPath] : []),
];

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Docker 下只用进程环境（compose environment / env_file 已在启动时注入），避免 .env 再次覆盖
      ...(inDocker
        ? { ignoreEnvFile: true }
        : envFilePath.length > 0
          ? { envFilePath }
          : {}),
    }),
    DatabaseModule,
    AuthModule,
    TasksModule,
    ToolsModule,
    WorksModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
