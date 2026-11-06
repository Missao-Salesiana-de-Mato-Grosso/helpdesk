import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ApiErrorCode,
  type CannedResponse,
  type CreateCannedResponseInput,
  type UpdateCannedResponseInput,
} from '@helpdesk/shared';
import { ApiException } from '../common/api-exception.js';
import { isUuid } from '../common/uuid.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { cleanBody } from '../tickets/tickets.service.js';

const select = { id: true, title: true, bodyHtml: true, updatedAt: true } as const;

type Row = Prisma.CannedResponseGetPayload<{ select: typeof select }>;

const toResponse = (row: Row): CannedResponse => ({
  ...row,
  updatedAt: row.updatedAt.toISOString(),
});

const notFound = () =>
  new ApiException(HttpStatus.NOT_FOUND, ApiErrorCode.NOT_FOUND, 'Resposta pronta não encontrada.');

/** T26: respostas prontas. O título é citext, então o índice único já ignora maiúsculas. */
@Injectable()
export class CannedResponsesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<CannedResponse[]> {
    const rows = await this.prisma.cannedResponse.findMany({ select, orderBy: { title: 'asc' } });
    return rows.map(toResponse);
  }

  async create(input: CreateCannedResponseInput, actorId: string): Promise<CannedResponse> {
    const row = await this.uniqueTitle(() =>
      this.prisma.cannedResponse.create({
        data: { title: input.title, bodyHtml: cleanBody(input.bodyHtml), createdById: actorId },
        select,
      }),
    );
    return toResponse(row);
  }

  async update(id: string, input: UpdateCannedResponseInput): Promise<CannedResponse> {
    if (!isUuid(id)) throw notFound();
    const data = {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.bodyHtml !== undefined ? { bodyHtml: cleanBody(input.bodyHtml) } : {}),
    };
    const row = await this.uniqueTitle(() =>
      this.prisma.cannedResponse.update({ where: { id }, data, select }),
    );
    return toResponse(row);
  }

  async remove(id: string): Promise<void> {
    if (!isUuid(id)) throw notFound();
    const { count } = await this.prisma.cannedResponse.deleteMany({ where: { id } });
    if (count === 0) throw notFound();
  }

  /** P2002: título repetido → 409; P2025: o registro do update não existe → 404. */
  private async uniqueTitle(write: () => Promise<Row>): Promise<Row> {
    try {
      return await write();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new ApiException(
            HttpStatus.CONFLICT,
            ApiErrorCode.NAME_TAKEN,
            'Já existe uma resposta pronta com esse título.',
          );
        }
        if (error.code === 'P2025') throw notFound();
      }
      throw error;
    }
  }
}
