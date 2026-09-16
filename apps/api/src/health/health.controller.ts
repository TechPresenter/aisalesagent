import { Controller, Get } from "@nestjs/common";
import { Public } from "../auth/decorators";
import { PrismaService } from "../prisma/prisma.service";

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness — the process is up. No dependencies touched, so it stays fast. */
  @Public()
  @Get()
  live(): { status: string; uptime: number } {
    return { status: "ok", uptime: Math.round(process.uptime()) };
  }

  /** Readiness — the process can actually serve, which means the database answers. */
  @Public()
  @Get("ready")
  async ready(): Promise<{ status: string; database: string }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: "ok", database: "up" };
    } catch {
      return { status: "degraded", database: "down" };
    }
  }
}
