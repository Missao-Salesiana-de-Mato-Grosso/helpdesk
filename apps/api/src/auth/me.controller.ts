import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  Patch,
  Put,
  Res,
  StreamableFile,
  UploadedFiles,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiErrorCode,
  ROLES,
  updateMeSchema,
  updateSignatureSchema,
  type MeResponse,
  type SignatureResponse,
  type UpdateMeInput,
  type UpdateSignatureInput,
} from '@helpdesk/shared';
import {
  AcceptsSignatureImages,
  JsonOrMultipartPipe,
  incomingUpload,
  type UploadedFields,
} from '../attachments/upload.js';
import { ApiException } from '../common/api-exception.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CompaniesService } from '../companies/companies.service.js';
import { DepartmentsService } from '../departments/departments.service.js';
import { SignatureService } from '../users/signature.service.js';
import { UsersService, type UserProfile } from '../users/users.service.js';
import type { CurrentUser as CurrentUserType } from './current-user.js';
import { AllowDuringOnboarding, AllowWhilePending, CurrentUser, Roles } from './decorators.js';
import { UserCache } from './user-cache.js';

@Controller('me')
@AllowDuringOnboarding()
@AllowWhilePending()
export class MeController {
  constructor(
    private readonly users: UsersService,
    private readonly companies: CompaniesService,
    private readonly departments: DepartmentsService,
    private readonly cache: UserCache,
    private readonly signatures: SignatureService,
  ) {}

  @Get()
  async get(@CurrentUser() user: CurrentUserType): Promise<MeResponse> {
    const profile = await this.users.findProfile(user.id);
    if (!profile)
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        ApiErrorCode.NOT_FOUND,
        'Usuário não encontrado.',
      );
    return toMeResponse(profile, user);
  }

  /** Tela de 1º acesso (RN-15). */
  @Patch()
  async update(
    @CurrentUser() user: CurrentUserType,
    @Body(new ZodValidationPipe(updateMeSchema)) body: UpdateMeInput,
  ): Promise<MeResponse> {
    const [companyOk, departmentOk] = await Promise.all([
      this.companies.isActive(body.companyId),
      this.departments.isActive(body.departmentId),
    ]);
    if (!companyOk || !departmentOk) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ApiErrorCode.VALIDATION_ERROR,
        !companyOk ? 'Unidade inexistente ou inativa.' : 'Departamento inexistente ou inativo.',
      );
    }
    const profile = await this.users.setCompanyAndDepartment(
      user.id,
      body.companyId,
      body.departmentId,
    );
    this.cache.invalidate(user.zitadelSub);
    return toMeResponse(profile, user);
  }

  /** T31: a assinatura de e-mail do próprio agente (RN-01, RN-02). */
  @Get('signature')
  @Roles('agente', 'supervisor', 'admin')
  async getSignature(@CurrentUser() user: CurrentUserType): Promise<SignatureResponse> {
    return { signatureHtml: await this.signatures.signatureOf(user.id) };
  }

  /** T31: sanitiza antes de gravar; sem texto visível apaga (RN-04, RN-05). */
  @Put('signature')
  @Roles('agente', 'supervisor', 'admin')
  @AcceptsSignatureImages()
  async updateSignature(
    @CurrentUser() user: CurrentUserType,
    @Body(new JsonOrMultipartPipe(updateSignatureSchema)) body: UpdateSignatureInput,
    @UploadedFiles() files: UploadedFields,
  ): Promise<SignatureResponse> {
    const signatureHtml = await this.signatures.save(user.id, body, incomingUpload(files).inline);
    return { signatureHtml };
  }

  /** T33 RN-09: só a própria imagem, sempre como anexo e com `nosniff`. */
  @Get('signature/images/:id')
  @Roles('agente', 'supervisor', 'admin')
  async signatureImage(
    @CurrentUser() user: CurrentUserType,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const { image, stream } = await this.signatures.openImage(user.id, id);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(stream, {
      type: image.mimeType,
      length: image.sizeBytes,
      disposition: 'attachment; filename="assinatura"',
    });
  }
}

function toMeResponse(profile: UserProfile, user: CurrentUserType): MeResponse {
  return {
    id: profile.id,
    name: profile.name,
    email: profile.email,
    roles: ROLES.filter((role) => user.roles.includes(role)),
    isAgent: user.isAgent,
    company: profile.company,
    department: profile.department,
    groups: user.isAgent ? profile.groupMemberships.map((m) => m.group) : [],
    needsOnboarding: profile.companyId === null || profile.departmentId === null,
    accessStatus: user.accessStatus,
  };
}
