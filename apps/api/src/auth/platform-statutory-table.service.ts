import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../core/prisma.service";
import {
  contentHashOf,
  EDITION_SCHEMES,
  parseContent,
} from "../statutory/editions";
import { STATUTORY_SCHEDULES } from "../statutory/registry";
import { CreateStatutoryTableVersionDto } from "./dto/create-statutory-table-version.dto";

/**
 * THE PLATFORM'S REGISTER OF STATUTORY EDITIONS. Kuwick's owner adds a later
 * edition of a table here — the same shape the engines read, with its source
 * document, year and in-force date — and every clinic's payroll resolves to
 * it from that date. A clinic can see it; only the platform can add one, and
 * only one not yet in force can be taken back, because a month priced on an
 * edition must stay traceable to it.
 */
@Injectable()
export class PlatformStatutoryTableService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const versions = await this.prisma.statutoryTableVersion.findMany({
      orderBy: [{ scheme: "asc" }, { inForceFrom: "desc" }],
      include: { createdBy: { select: { fullName: true, email: true } } },
    });
    return {
      schemes: EDITION_SCHEMES,
      // What Kuwick ships, so the console shows the whole line of editions.
      builtIn: STATUTORY_SCHEDULES.filter((schedule) =>
        (EDITION_SCHEMES as readonly string[]).includes(schedule.scheme),
      ).map((schedule) => ({
        id: schedule.id,
        scheme: schedule.scheme,
        document: schedule.document,
        section: schedule.section,
        inForceFrom: schedule.effectiveFrom.toISOString().slice(0, 10),
        verification: schedule.verification,
        contentHash: schedule.contentHash,
      })),
      versions: versions.map((row) => this.present(row)),
    };
  }

  async create(dto: CreateStatutoryTableVersionDto, platformAdminId: string) {
    const parsed = parseContent(dto.scheme, dto.content);
    if (!parsed.ok) {
      throw new BadRequestException({
        message: `The ${dto.scheme} edition was not stored: ${parsed.problems.length} problem(s).`,
        problems: parsed.problems,
      });
    }
    const inForceFrom = new Date(
      `${dto.inForceFrom.slice(0, 10)}T00:00:00.000Z`,
    );
    if (Number.isNaN(inForceFrom.getTime()))
      throw new BadRequestException("inForceFrom must be a YYYY-MM-DD date.");
    // An edition on the same date as the built-in one would silently replace
    // verified figures with typed ones for every month since; later only.
    const builtIn = STATUTORY_SCHEDULES.filter(
      (schedule) => schedule.scheme === dto.scheme,
    )
      .map((schedule) => schedule.effectiveFrom.getTime())
      .sort((a, b) => b - a)[0];
    if (builtIn !== undefined && inForceFrom.getTime() <= builtIn) {
      throw new BadRequestException(
        `Kuwick already holds a verified ${dto.scheme} edition in force from ${new Date(builtIn).toISOString().slice(0, 10)}. A platform edition must be in force from a later date.`,
      );
    }
    try {
      const row = await this.prisma.statutoryTableVersion.create({
        data: {
          scheme: dto.scheme,
          year: dto.year,
          inForceFrom,
          sourceDocument: dto.sourceDocument,
          sourceUrl: dto.sourceUrl ?? null,
          note: dto.note ?? null,
          content: dto.content as Prisma.InputJsonValue,
          contentHash: contentHashOf(dto.content),
          createdByPlatformAdminId: platformAdminId,
        },
        include: { createdBy: { select: { fullName: true, email: true } } },
      });
      return this.present(row);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException(
          `A ${dto.scheme} edition in force from ${dto.inForceFrom.slice(0, 10)} is already on file.`,
        );
      }
      throw error;
    }
  }

  /** Only an edition not yet in force can be withdrawn: a month priced on one must stay traceable to it. */
  async remove(id: string) {
    const row = await this.prisma.statutoryTableVersion.findUnique({
      where: { id },
    });
    if (!row) throw new NotFoundException("That edition is not on file.");
    const today = new Date(new Date().toISOString().slice(0, 10));
    if (row.inForceFrom.getTime() <= today.getTime()) {
      throw new BadRequestException(
        `The ${row.scheme} edition in force from ${row.inForceFrom.toISOString().slice(0, 10)} may already have priced a month. It cannot be withdrawn; add a later edition instead.`,
      );
    }
    await this.prisma.statutoryTableVersion.delete({ where: { id } });
    return { deleted: true };
  }

  private present(row: {
    id: string;
    scheme: string;
    year: number;
    inForceFrom: Date;
    sourceDocument: string;
    sourceUrl: string | null;
    note: string | null;
    content: unknown;
    contentHash: string;
    createdAt: Date;
    createdBy: { fullName: string; email: string };
  }) {
    const parsed = parseContent(row.scheme, row.content);
    return {
      id: row.id,
      scheme: row.scheme,
      year: row.year,
      inForceFrom: row.inForceFrom.toISOString().slice(0, 10),
      sourceDocument: row.sourceDocument,
      sourceUrl: row.sourceUrl,
      note: row.note,
      contentHash: row.contentHash,
      createdAt: row.createdAt.toISOString(),
      createdBy: row.createdBy.fullName || row.createdBy.email,
      /** A row that no longer parses would be skipped by the engines; said here rather than discovered on a payslip. */
      readable: parsed.ok,
      summary: summarise(row.scheme, row.content),
    };
  }
}

/** A line about the content, for the list: how many bands, which ceiling. */
function summarise(scheme: string, content: unknown): string {
  const c = (content ?? {}) as Record<string, unknown>;
  const rm = (cents: unknown) =>
    typeof cents === "number"
      ? `RM${(cents / 100).toLocaleString("en-MY")}`
      : "?";
  switch (scheme) {
    case "EPF": {
      const parts = Array.isArray(c.parts) ? c.parts : [];
      return `${parts.length} parts, ${parts.reduce((sum: number, part: unknown) => sum + ((part as { bands?: unknown[] }).bands?.length ?? 0), 0)} bands, ceiling ${rm(c.ceilingCents)}`;
    }
    case "SOCSO":
    case "EIS":
      return `${Array.isArray(c.bands) ? c.bands.length : 0} bands, ceiling ${rm(c.ceilingCents)}`;
    case "LINDUNG":
      return `in force from ${String(c.effectiveFrom ?? "?")}`;
    case "PCB":
      return `${Array.isArray(c.table1) ? c.table1.length : 0} rows in Table 1, individual relief ${rm(c.individualCents)}`;
    case "HRD_LEVY":
      return `s.14 ${String(c.mandatoryPercent ?? "?")}%, s.15 ${String(c.optionalPercent ?? "?")}%`;
    default:
      return "";
  }
}
