import {
  Alert,
  Button,
  Container,
  Group,
  Loader,
  Paper,
  Radio,
  Stack,
  Text,
  Textarea,
  Title,
} from '@mantine/core';
import {
  ApiErrorCode,
  isSatisfactionScore,
  MAX_SATISFACTION_COMMENT_LENGTH,
  SATISFACTION_LABELS,
  SATISFACTION_SCORES,
  type SatisfactionRateInput,
  type SatisfactionScore,
  type SatisfactionSurvey,
} from '@helpdesk/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useLocation } from 'react-router';
import { useApi } from '../../api/api-context.ts';
import { ApiRequestError } from '../../api/client.ts';
import { StatusScreen } from '../../components/StatusScreen.tsx';

/** T40 RN-08: página pública, fora do login. */
export const SURVEY_PATH = '/avaliar';

const isLinkInvalid = (error: unknown) =>
  error instanceof ApiRequestError && error.code === ApiErrorCode.SURVEY_LINK_INVALID;

/** `?nota=<n>` do link do e-mail: só pré-seleciona (RN-08). Valor estranho é ignorado. */
function presetScore(search: string): SatisfactionScore | null {
  const value = Number(new URLSearchParams(search).get('nota'));
  return isSatisfactionScore(value) ? value : null;
}

function InvalidLink() {
  return (
    <StatusScreen title="Link de avaliação inválido">
      Este link de avaliação expirou ou foi substituído por um mais novo. Se precisar de ajuda,
      responda o e-mail do chamado.
    </StatusScreen>
  );
}

/**
 * T40: o solicitante avalia o atendimento pelo link do e-mail de resolvido. O token vem no
 * fragmento (`#…`, RN-07) e vai à API no corpo; a nota só é gravada no "Enviar avaliação".
 */
export function SatisfactionPage() {
  const { hash, search } = useLocation();
  const token = hash.replace(/^#/, '');
  const api = useApi();

  const survey = useQuery({
    queryKey: ['satisfaction', token],
    queryFn: () =>
      api<SatisfactionSurvey>('/satisfaction/lookup', {
        method: 'POST',
        body: JSON.stringify({ token }),
      }),
    enabled: token !== '',
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (token === '' || isLinkInvalid(survey.error)) return <InvalidLink />;
  if (survey.error) {
    return (
      <StatusScreen title="Não foi possível abrir a avaliação">{survey.error.message}</StatusScreen>
    );
  }
  if (!survey.data) return <Loader aria-label="Carregando" />;

  return (
    <Container size="xs" py="xl">
      <SurveyForm token={token} survey={survey.data} preset={presetScore(search)} />
    </Container>
  );
}

function SurveyForm({
  token,
  survey,
  preset,
}: {
  token: string;
  survey: SatisfactionSurvey;
  preset: SatisfactionScore | null;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(survey.score === null);
  const [score, setScore] = useState<SatisfactionScore | null>(survey.score ?? preset);
  const [comment, setComment] = useState(survey.comment ?? '');

  const save = useMutation({
    mutationFn: (body: SatisfactionRateInput) =>
      api<SatisfactionSurvey>('/satisfaction', { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: (saved) => {
      queryClient.setQueryData(['satisfaction', token], saved);
      setEditing(false);
    },
  });

  if (isLinkInvalid(save.error)) return <InvalidLink />;

  const header = (
    <Stack gap={4}>
      <Text size="sm" c="dimmed">
        Suporte MSMT — Missão Salesiana de Mato Grosso
      </Text>
      <Title order={1} size="h3">
        Avaliação do atendimento
      </Title>
      <Text>
        Chamado #{survey.ticketNumber} — {survey.ticketSubject}
      </Text>
    </Stack>
  );

  if (!editing && survey.score !== null) {
    return (
      <Paper withBorder p="lg">
        <Stack>
          {header}
          <Alert color="green" title="Obrigado! Sua avaliação foi registrada.">
            <Text size="sm">
              Sua nota: {survey.score} — {SATISFACTION_LABELS[survey.score]}
            </Text>
            {survey.comment && (
              <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                {survey.comment}
              </Text>
            )}
          </Alert>
          <Group>
            <Button variant="light" onClick={() => setEditing(true)}>
              Alterar
            </Button>
          </Group>
        </Stack>
      </Paper>
    );
  }

  return (
    <Paper withBorder p="lg">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (score !== null) save.mutate({ token, score, comment: comment.trim() || null });
        }}
      >
        <Stack>
          {header}
          {survey.score === null && preset !== null && score === preset && (
            <Alert color="blue">Falta só confirmar: clique em Enviar avaliação.</Alert>
          )}
          <Radio.Group
            label="Como foi o atendimento?"
            value={score === null ? null : String(score)}
            onChange={(value) => {
              const next = Number(value);
              if (isSatisfactionScore(next)) setScore(next);
            }}
          >
            <Stack gap="xs" mt="xs">
              {SATISFACTION_SCORES.map((value) => (
                <Radio
                  key={value}
                  value={String(value)}
                  label={`${value} — ${SATISFACTION_LABELS[value]}`}
                />
              ))}
            </Stack>
          </Radio.Group>
          <Textarea
            label="Quer contar mais? (opcional)"
            value={comment}
            onChange={(event) => setComment(event.currentTarget.value)}
            maxLength={MAX_SATISFACTION_COMMENT_LENGTH}
            description={`${comment.length}/${MAX_SATISFACTION_COMMENT_LENGTH}`}
            rows={4}
          />
          {save.error && (
            <Alert color="red" title="Não foi possível enviar">
              {save.error.message}
            </Alert>
          )}
          <Group>
            <Button type="submit" disabled={score === null} loading={save.isPending}>
              Enviar avaliação
            </Button>
          </Group>
        </Stack>
      </form>
    </Paper>
  );
}
