import { Alert, Button, Group, Loader, Paper, Stack, Text, Title, Typography } from '@mantine/core';
import { MAX_SIGNATURE_HTML_LENGTH } from '@helpdesk/shared';
import { useState } from 'react';
import { HtmlEditor } from '../../components/HtmlEditor.tsx';
import {
  SIGNATURE_IMAGE_RULES,
  useInlineImages,
  withInlineImages,
} from '../attachments/inline-images.ts';
import { useSaveSignature, useSignature, useSignatureImageUrls, withImageUrls } from './queries.ts';

/** T31: o agente cadastra a assinatura que vai nos e-mails das respostas dele (T33: com imagens). */
export function SignaturePage() {
  const signature = useSignature();
  const save = useSaveSignature();
  const saved = signature.data?.signatureHtml ?? null;
  const images = useSignatureImageUrls(signature.data ? saved : undefined);
  const savedWithUrls = saved && withImageUrls(saved, images.urls);

  return (
    <Stack maw={720}>
      <div>
        <Title order={2}>Minha assinatura</Title>
        <Text c="dimmed" size="sm">
          Aparece no fim do e-mail quando você responde um chamado pelo portal. Ela não é mostrada
          na conversa do chamado.
        </Text>
      </div>
      {(signature.isPending || (signature.data && !images.ready)) && (
        <Loader aria-label="Carregando" />
      )}
      {signature.error && (
        <Alert color="red" title="Não foi possível carregar a assinatura">
          {signature.error.message}
        </Alert>
      )}
      {/*
        O editor só recebe o conteúdo inicial ao montar: espera a assinatura e as imagens dela.
        Depois de salvar, monta de novo com o que o servidor gravou (as imagens novas já com id).
      */}
      {signature.data && images.ready && (
        <SignatureForm key={saved ?? ''} initial={savedWithUrls ?? ''} save={save} />
      )}
      {save.isSuccess && (
        <Alert color="green" role="status">
          {saved ? 'Assinatura salva.' : 'Assinatura removida.'}
        </Alert>
      )}
      {signature.data && images.ready && <SignaturePreview html={savedWithUrls} />}
    </Stack>
  );
}

function SignatureForm({
  initial,
  save,
}: {
  initial: string;
  save: ReturnType<typeof useSaveSignature>;
}) {
  const [html, setHtml] = useState(initial);
  const images = useInlineImages(SIGNATURE_IMAGE_RULES);
  const tooLong = html.length > MAX_SIGNATURE_HTML_LENGTH;

  const submit = () => {
    const upload = images.collect(html);
    save.mutate({ data: withInlineImages({ signatureHtml: html }, upload), inline: upload.inline });
  };

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
        images={images}
      />
      <Text c="dimmed" size="xs">
        Texto formatado, links e até 2 imagens (PNG ou JPG, até 200 KB cada), como o logo da
        unidade. Para remover a assinatura, apague tudo e salve.
      </Text>
      {save.error && (
        <Alert color="red" title="Não foi possível salvar">
          {save.error.message}
        </Alert>
      )}
      <Group justify="flex-end">
        <Button loading={save.isPending} disabled={tooLong} onClick={submit}>
          Salvar
        </Button>
      </Group>
    </Stack>
  );
}

/** Como a assinatura salva aparece abaixo de uma resposta, no e-mail. */
function SignaturePreview({ html }: { html: string | null }) {
  return (
    <section aria-label="Prévia no e-mail">
      <Text fw={500} size="sm" mb={4}>
        Prévia no e-mail
      </Text>
      <Paper withBorder p="sm" bg="gray.0">
        <Text size="sm" c="dimmed">
          (texto da sua resposta)
        </Text>
        {html ? (
          <Typography
            mt="md"
            // oxlint-disable-next-line react/no-danger -- HTML já sanitizado no backend; só ganha o `src` blob: das imagens.
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <Text size="sm" c="dimmed" mt="md" fs="italic">
            Sem assinatura: o e-mail termina no texto da resposta.
          </Text>
        )}
      </Paper>
    </section>
  );
}
