import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type AiAgent } from "@prisma/client";
import { TenantPrismaFactory } from "../prisma/tenant-prisma.provider";
import { scopedCreate } from "../prisma/tenant-scoped";
import {
  readObjections,
  readQuestions,
  type ObjectionResponse,
  type QualificationQuestion,
} from "./agent-script";

export type { ObjectionResponse, QualificationQuestion } from "./agent-script";

export interface AgentStats {
  total: number;
  active: number;
  callsPlaced: number;
  connectRate: number;
}

const AGENT_INCLUDE = {
  _count: { select: { calls: true, campaigns: true } },
} satisfies Prisma.AiAgentInclude;

/**
 * Feature List §12 — AI Agents.
 *
 * An agent is a script and a voice, not a model. Everything here is configuration the
 * calling pipeline reads at dial time; nothing in this service talks to a provider, and
 * an agent that is saved is not thereby capable of making a call — that needs telephony
 * and speech credentials, which live in Settings and are checked separately.
 */
@Injectable()
export class AgentsService {
  constructor(private readonly tenantPrisma: TenantPrismaFactory) {}

  private get db() {
    return this.tenantPrisma.client;
  }

  async list(query: { search?: string; activeOnly?: boolean; language?: string } = {}) {
    const where: Prisma.AiAgentWhereInput = {};
    if (query.activeOnly) where.isActive = true;
    if (query.language) where.language = query.language;
    if (query.search) {
      const term = query.search.trim();
      where.OR = [
        { name: { contains: term, mode: "insensitive" } },
        { personality: { contains: term, mode: "insensitive" } },
      ];
    }

    const rows = await this.db.aiAgent.findMany({
      where,
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      include: AGENT_INCLUDE,
    });

    return rows.map(withReadableScript);
  }

  async stats(): Promise<AgentStats> {
    const total = await this.db.aiAgent.count();
    const active = await this.db.aiAgent.count({ where: { isActive: true } });
    const callsPlaced = await this.db.call.count({ where: { aiAgentId: { not: null } } });
    const connected = await this.db.call.count({
      where: { aiAgentId: { not: null }, status: "COMPLETED" },
    });

    return {
      total,
      active,
      callsPlaced,
      // Rounded to a whole percent here rather than in the browser, so every screen that
      // shows this number shows the same number.
      connectRate: callsPlaced === 0 ? 0 : Math.round((connected / callsPlaced) * 100),
    };
  }

  /**
   * Calls and interested outcomes per agent — the Analytics comparison. Two grouped
   * queries for the whole workspace rather than two queries per agent.
   */
  async performance(): Promise<
    { id: string; name: string; language: string; calls: number; interested: number }[]
  > {
    const agents = await this.db.aiAgent.findMany({
      select: { id: true, name: true, language: true },
    });
    const groups = await this.db.call.groupBy({
      by: ["aiAgentId", "outcome"],
      where: { aiAgentId: { not: null } },
      _count: { _all: true },
    });

    return agents
      .map((agent) => {
        const rows = groups.filter((group) => group.aiAgentId === agent.id);
        return {
          id: agent.id,
          name: agent.name,
          language: agent.language,
          calls: rows.reduce((sum, row) => sum + row._count._all, 0),
          interested: rows
            .filter((row) => row.outcome === "INTERESTED")
            .reduce((sum, row) => sum + row._count._all, 0),
        };
      })
      .sort((a, b) => b.calls - a.calls);
  }

  async findOne(id: string) {
    const agent = await this.db.aiAgent.findUnique({ where: { id }, include: AGENT_INCLUDE });
    if (!agent) throw new NotFoundException("Agent not found");
    return withReadableScript(agent);
  }

  async create(input: AgentInput): Promise<AiAgent> {
    const name = input.name.trim();
    if (!name) throw new BadRequestException("An agent needs a name.");

    // Pre-checked as well as caught below. The dev database cannot always report a unique
    // violation as P2002 — it surfaces as an unparseable error that poisons the
    // connection — so the check has to happen before the insert, and the catch is what
    // covers the race between two people saving the same name at once.
    const clash = await this.db.aiAgent.findFirst({ where: { name } });
    if (clash) throw new ConflictException(`An agent called "${name}" already exists.`);

    try {
      return await this.db.aiAgent.create({
        data: scopedCreate<Prisma.AiAgentUncheckedCreateInput>({
          ...this.writable(input),
          name,
          isActive: input.isActive ?? true,
        }),
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException(`An agent called "${name}" already exists.`);
      }
      throw error;
    }
  }

  async update(id: string, input: Partial<AgentInput>): Promise<AiAgent> {
    const existing = await this.db.aiAgent.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Agent not found");

    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new BadRequestException("An agent needs a name.");
      const clash = await this.db.aiAgent.findFirst({ where: { name, NOT: { id } } });
      if (clash) throw new ConflictException(`An agent called "${name}" already exists.`);
    }

    try {
      return await this.db.aiAgent.update({
        where: { id },
        data: {
          ...this.writable(input),
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Another agent already has that name.");
      }
      throw error;
    }
  }

  /**
   * Copies an agent, script and all.
   *
   * The copy is deactivated on purpose. Duplicating is how you try a variation of a script
   * that works, and a duplicate that arrives live is one an in-flight campaign could pick
   * up before anyone has read it.
   */
  async duplicate(id: string): Promise<AiAgent> {
    const source = await this.db.aiAgent.findUnique({ where: { id } });
    if (!source) throw new NotFoundException("Agent not found");

    const name = await this.availableName(`${source.name} (copy)`);

    return this.db.aiAgent.create({
      data: scopedCreate<Prisma.AiAgentUncheckedCreateInput>({
        name,
        avatarUrl: source.avatarUrl,
        language: source.language,
        accent: source.accent,
        gender: source.gender,
        voiceId: source.voiceId,
        personality: source.personality,
        systemPrompt: source.systemPrompt,
        openingMessage: source.openingMessage,
        qualificationQuestions: source.qualificationQuestions ?? Prisma.DbNull,
        objectionHandling: source.objectionHandling ?? Prisma.DbNull,
        closingInstructions: source.closingInstructions,
        knowledgeBase: source.knowledgeBase,
        transferRules: source.transferRules ?? Prisma.DbNull,
        dispositionRules: source.dispositionRules ?? Prisma.DbNull,
        isActive: false,
      }),
    });
  }

  /**
   * Deletes an agent, or refuses.
   *
   * Calls and campaigns point at the agent that made or will make them. Deleting one that
   * has a call history would either orphan those rows or, worse, quietly rewrite the
   * record of who said what — so an agent that has been used is deactivated instead, and
   * the caller is told why.
   */
  async remove(id: string): Promise<void> {
    const agent = await this.db.aiAgent.findUnique({
      where: { id },
      include: { _count: { select: { calls: true, campaigns: true } } },
    });
    if (!agent) throw new NotFoundException("Agent not found");

    if (agent._count.calls > 0) {
      throw new ConflictException(
        `${agent.name} has made ${agent._count.calls} call${
          agent._count.calls === 1 ? "" : "s"
        }. Deactivate it instead — deleting it would erase who made them.`,
      );
    }
    if (agent._count.campaigns > 0) {
      throw new ConflictException(
        `${agent.name} is assigned to ${agent._count.campaigns} campaign${
          agent._count.campaigns === 1 ? "" : "s"
        }. Point those at another agent first.`,
      );
    }

    await this.db.aiAgent.delete({ where: { id } });
  }

  /** "Anjali (copy)", then "Anjali (copy) 2", … — the first name nothing is using. */
  private async availableName(base: string): Promise<string> {
    for (let suffix = 0; suffix < 50; suffix += 1) {
      const candidate = suffix === 0 ? base : `${base} ${suffix + 1}`;
      const taken = await this.db.aiAgent.findFirst({ where: { name: candidate } });
      if (!taken) return candidate;
    }
    return `${base} ${Date.now()}`;
  }

  /** The fields a caller may set, mapped straight through. `name` is handled separately. */
  private writable(input: Partial<AgentInput>) {
    return {
      avatarUrl: input.avatarUrl,
      language: input.language,
      accent: input.accent,
      gender: input.gender,
      voiceId: input.voiceId,
      personality: input.personality,
      systemPrompt: input.systemPrompt,
      openingMessage: input.openingMessage,
      closingInstructions: input.closingInstructions,
      knowledgeBase: input.knowledgeBase,
      ...(input.qualificationQuestions !== undefined
        ? { qualificationQuestions: toJson(input.qualificationQuestions) }
        : {}),
      ...(input.objectionHandling !== undefined
        ? { objectionHandling: toJson(input.objectionHandling) }
        : {}),
      ...(input.transferRules !== undefined
        ? { transferRules: toJson(input.transferRules) }
        : {}),
      ...(input.dispositionRules !== undefined
        ? { dispositionRules: toJson(input.dispositionRules) }
        : {}),
    };
  }
}

/**
 * Prisma's `InputJsonValue` does not accept an arbitrary interface — an object type with
 * named fields has no index signature, so structurally it is not a JSON object as far as
 * the type system is concerned. Round-tripping through `unknown` at this one boundary is
 * the honest way to say "this is data, and it is being stored as data".
 */
function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

/**
 * Hands back an agent whose script columns are in the shape the editor expects.
 *
 * Applied on every read, not just where a legacy row is suspected: the columns are `Json?`
 * and nothing at the database level constrains them, so "the shape is whatever was last
 * written" is the only safe assumption. See agent-script.ts for what this protects against.
 */
function withReadableScript<T extends {
  qualificationQuestions: Prisma.JsonValue | null;
  objectionHandling: Prisma.JsonValue | null;
}>(agent: T): Omit<T, "qualificationQuestions" | "objectionHandling"> & {
  qualificationQuestions: QualificationQuestion[];
  objectionHandling: ObjectionResponse[];
} {
  return {
    ...agent,
    qualificationQuestions: readQuestions(agent.qualificationQuestions),
    objectionHandling: readObjections(agent.objectionHandling),
  };
}

export interface AgentInput {
  name: string;
  avatarUrl?: string;
  language?: string;
  accent?: string;
  gender?: string;
  voiceId?: string;
  personality?: string;
  systemPrompt?: string;
  openingMessage?: string;
  qualificationQuestions?: QualificationQuestion[];
  objectionHandling?: ObjectionResponse[];
  closingInstructions?: string;
  knowledgeBase?: string;
  transferRules?: Record<string, unknown>;
  dispositionRules?: Record<string, unknown>;
  isActive?: boolean;
}
