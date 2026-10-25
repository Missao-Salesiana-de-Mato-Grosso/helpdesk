import { Alert, Button, Group, Paper, Select, Stack, TextInput, Title } from '@mantine/core';
import { createTicketSchema, type CreateTicketData, type NamedRef } from '@helpdesk/shared';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useMe } from '../../auth/useMe.ts';
import { HtmlEditor } from '../../components/HtmlEditor.tsx';
import { AttachmentPicker } from '../attachments/AttachmentPicker.tsx';
import { useCategories, useCompanies, useCreateTicket, useTicket } from './queries.ts';

/** Texto do 04-lgpd.md §4.1, mitigação 1. */
export const LGPD_NOTICE =
  'Não inclua dados pessoais de alunos, atendidos ou informações de saúde, a menos que sejam indispensáveis para resolver o problema.';

type Field = 'subject' | 'categoryId' | 'companyId' | 'bodyHtml';

const FIELD_MESSAGE: Partial<Record<Field, string>> = {
  categoryId: 'Escolha a categoria',
  companyId: 'Escolha a unidade',
};

const toOptions = (items: NamedRef[] | undefined) =>
  (items ?? []).map((item) => ({ value: item.id, label: item.name }));

function validate(input: Record<string, unknown>): {
  data?: CreateTicketData;
  errors: Partial<Record<Field, string>>;
} {
  const parsed = createTicketSchema.safeParse(input);
  if (parsed.success) return { data: parsed.data, errors: {} };
  const errors: Partial<Record<Field, string>> = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if (
      field === 'subject' ||
      field === 'categoryId' ||
      field === 'companyId' ||
      field === 'bodyHtml'
    ) {
      errors[field] ??= FIELD_MESSAGE[field] ?? issue.message;
    }
  }
  return { errors };
}

/** "Novo ticket" (T11). `?relacionado=<id>` abre um chamado ligado a um fechado (RN-11 da T08). */
export function NewTicketPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { data: me } = useMe();
  const categories = useCategories();
  const companies = useCompanies();
  const related = useTicket(searchParams.get('relacionado') ?? undefined);
  const create = useCreateTicket();

  const [subject, setSubject] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  // `undefined` = ainda não mexeu: vale a unidade do cadastro.
  const [companyChoice, setCompanyChoice] = useState<string | null | undefined>(undefined);
  const [bodyHtml, setBodyHtml] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [submitted, setSubmitted] = useState(false);

  const companyId = companyChoice === undefined ? (me?.company?.id ?? null) : companyChoice;
  const validation = validate({
    subject,
    bodyHtml,
    categoryId: categoryId ?? undefined,
    // Unidade obrigatória na tela (o schema a deixa opcional porque o backend herda a do solicitante).
    companyId: companyId ?? undefined,
    relatedTicketId: related.data?.id,
  });
  if (!companyId) validation.errors.companyId ??= FIELD_MESSAGE.companyId;
  const errors = submitted ? validation.errors : {};

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (!validation.data || Object.keys(validation.errors).length > 0) return;
    create.mutate(
      { data: validation.data, files },
      {
        onSuccess: (ticket) => void navigate(`/tickets/${ticket.id}`, { replace: true }),
      },
    );
  };

  const loadError = categories.error ?? companies.error;

  return (
    <Stack maw={760}>
      <Title order={1} size="h2">
        Novo ticket
      </Title>

      {related.data && (
        <Alert color="blue" title={`Relacionado ao chamado #${related.data.number}`}>
          {related.data.subject}
        </Alert>
      )}

      <Paper withBorder p="lg">
        <form onSubmit={onSubmit} noValidate>
          <Stack>
            {loadError && (
              <Alert color="red" title="Não foi possível carregar as opções">
                {loadError.message}
              </Alert>
            )}
            <TextInput
              label="Assunto"
              placeholder="Resuma o problema em poucas palavras"
              value={subject}
              onChange={(event) => setSubject(event.currentTarget.value)}
              maxLength={200}
              error={errors.subject}
              required
            />
            <Group grow align="flex-start">
              <Select
                label="Categoria"
                placeholder="Escolha a categoria"
                data={toOptions(categories.data)}
                value={categoryId}
                onChange={setCategoryId}
                searchable
                nothingFoundMessage="Nenhuma categoria encontrada"
                disabled={categories.isPending}
                error={errors.categoryId}
                required
              />
              <Select
                label="Unidade"
                placeholder="Escolha a escola ou obra"
                data={toOptions(companies.data)}
                value={companyId}
                onChange={setCompanyChoice}
                searchable
                nothingFoundMessage="Nenhuma unidade encontrada"
                disabled={companies.isPending}
                error={
                  errors.companyId ?? (submitted && !companyId ? 'Escolha a unidade' : undefined)
                }
                required
              />
            </Group>

            <Alert color="yellow" title="Atenção aos dados pessoais">
              {LGPD_NOTICE}
            </Alert>

            <HtmlEditor
              label="Descrição"
              value={bodyHtml}
              onChange={setBodyHtml}
              error={errors.bodyHtml}
              disabled={create.isPending}
            />
            <AttachmentPicker files={files} onChange={setFiles} disabled={create.isPending} />

            {create.error && (
              <Alert color="red" title="Não foi possível abrir o chamado">
                {create.error.message}
              </Alert>
            )}

            <Group justify="flex-end">
              <Button component={Link} to="/tickets" variant="subtle" color="gray">
                Cancelar
              </Button>
              <Button type="submit" loading={create.isPending}>
                Abrir chamado
              </Button>
            </Group>
          </Stack>
        </form>
      </Paper>
    </Stack>
  );
}
