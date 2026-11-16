import { Alert, Button, Group, Loader, Paper, Stack, Text, Title, Typography } from '@mantine/core';
import { MAX_SIGNATURE_HTML_LENGTH } from '@helpdesk/shared';
import { useState } from 'react';
import { HtmlEditor } from '../../components/HtmlEditor.tsx';
import { useSaveSignature, useSignature } from './queries.ts';

/** T31: o agente cadastra a assinatura que vai nos e-mails das respostas dele. */
export function SignaturePage() {
  const signature = useSignature();

  return (
    <Stack maw={720}>
      <div>
        <Title order={2}>Minha assinatura</Title>
        <Text c="dimmed" size="sm">
          Aparece no fim do e-mail quando você responde um chamado pelo portal. Ela não é mostrada
          na conversa do chamado.
        </Text>
      </div>
      {signature.isPending && <Loader aria-label="Carregando" />}
      {signature.error && (
        <Alert color="red" title="Não foi possível carregar a assinatura">
          {signature.error.message}
        </Alert>
      )}
      {/* O editor só recebe o conteúdo inicial ao montar: espera a assinatura chegar. */}
      {signature.data && <SignatureForm saved={signature.data.signatureHtml} />}
    </Stack>
  );
}

function SignatureForm({ saved }: { saved: string | null }) {
  const save = useSaveSignature();
  const [html, setHtml] = useState(saved ?? '');
  const tooLong = html.length > MAX_SIGNATURE_HTML_LENGTH;

  return (
    <Stack>
      <HtmlEditor
        label="Assinatura"
        value={html}
        onChange={(value) => {
          setHtml(value);
          save.reset();
        }}
        error={
          tooLong
            ? `A assinatura passa do limite de ${MAX_SIGNATURE_HTML_LENGTH} caracteres`
            : undefined
        }
        disabled={save.isPending}
        required={false}
      />
      <Text c="dimmed" size="xs">
        Texto formatado e links, sem imagens. Para remover a assinatura, apague o texto e salve.
      </Text>
      {save.error && (
        <Alert color="red" title="Não foi possível salvar">
          {save.error.message}
        </Alert>
      )}
      {save.isSuccess && (
        <Alert color="green" role="status">
          {saved ? 'Assinatura salva.' : 'Assinatura removida.'}
        </Alert>
      )}
      <Group justify="flex-end">
        <Button
          loading={save.isPending}
          disabled={tooLong}
          onClick={() => save.mutate({ signatureHtml: html })}
        >
          Salvar
        </Button>
      </Group>
      <SignaturePreview saved={saved} />
    </Stack>
  );
}

/** Como a assinatura salva aparece abaixo de uma resposta, no e-mail. */
function SignaturePreview({ saved }: { saved: string | null }) {
  return (
    <section aria-label="Prévia no e-mail">
      <Text fw={500} size="sm" mb={4}>
        Prévia no e-mail
      </Text>
      <Paper withBorder p="sm" bg="gray.0">
        <Text size="sm" c="dimmed">
          (texto da sua resposta)
        </Text>
        {saved ? (
          // oxlint-disable-next-line react/no-danger -- HTML já sanitizado no backend antes de gravar.
          <Typography mt="md" dangerouslySetInnerHTML={{ __html: saved }} />
        ) : (
          <Text size="sm" c="dimmed" mt="md" fs="italic">
            Sem assinatura: o e-mail termina no texto da resposta.
          </Text>
        )}
      </Paper>
    </section>
  );
}
