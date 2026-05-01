import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminRoleGuard } from '../governance/admin-role.guard';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [AuthModule],
  controllers: [AdminController],
  providers: [AdminService, AdminRoleGuard],
})
export class AdminModule {}
