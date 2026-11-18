import type { SignatureResponse, UpdateSignatureInput } from '@helpdesk/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useApi } from '../../api/api-context.ts';
import { requestBody } from '../attachments/attachments.ts';

const KEY = ['me', 'signature'] as const;

/** T31: a assinatura de e-mail do próprio agente. */
export function useSignature() {
  const api = useApi();
  return useQuery({
    queryKey: KEY,
    queryFn: () => api<SignatureResponse>('/me/signature'),
  });
}

/**
 * Grava e devolve a assinatura como ficou depois de sanitizada; vazio apaga. T33: as imagens
 * novas vão no campo `inline`, na ordem de `data.inlineImages`.
 */
export function useSaveSignature() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ data, inline = [] }: { data: UpdateSignatureInput; inline?: readonly File[] }) =>
      api<SignatureResponse>('/me/signature', {
        method: 'PUT',
        body: requestBody(data, [], inline),
      }),
    onSuccess: (saved) => queryClient.setQueryData(KEY, saved),
  });
}

const SIGNATURE_IMAGE = /<img\b([^>]*)\sdata-signature-image-id="([^"]+)"([^>]*)>/gi;

/** T33: ids das imagens que a assinatura salva referencia. */
export function signatureImageIds(html: string | null): string[] {
  return [...new Set([...(html ?? '').matchAll(SIGNATURE_IMAGE)].map((match) => match[2]!))];
}

/**
 * T33: põe o `src` (`blob:`) em cada imagem salva, para o editor e a prévia, com a largura do
 * e-mail (RN-10). Imagem sem URL (download falhou) sai do HTML. O servidor descarta `src` e
 * `style` ao gravar.
 */
export function withImageUrls(html: string, urls: ReadonlyMap<string, string>): string {
  return html.replace(SIGNATURE_IMAGE, (_tag, before: string, id: string, after: string) => {
    const url = urls.get(id);
    return url
      ? `<img${before} src="${url}" style="max-width:300px" data-signature-image-id="${id}"${after}>`
      : '';
  });
}

/**
 * T33 RN-16: baixa com o token as imagens da assinatura salva e devolve a URL `blob:` de cada
 * uma (as que falham ficam de fora). `ready` diz se todas as imagens do HTML atual já foram
 * tentadas.
 */
export function useSignatureImageUrls(html: string | null | undefined) {
  const api = useApi();
  const [urls, setUrls] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [tried, setTried] = useState<ReadonlySet<string>>(() => new Set());
  const key = signatureImageIds(html ?? null)
    .filter((id) => !tried.has(id))
    .join(',');

  useEffect(() => {
    let cancelled = false;
    if (key !== '') {
      void Promise.all(
        key.split(',').map(async (id) => {
          try {
            const blob = await api<Blob>(`/me/signature/images/${id}`, { responseType: 'blob' });
            return { id, url: URL.createObjectURL(blob) };
          } catch {
            // Sem a imagem, ela some do editor e da prévia (withImageUrls).
            return { id, url: null };
          }
        }),
      ).then((results) => {
        if (cancelled) {
          for (const { url } of results) if (url) URL.revokeObjectURL(url);
          return;
        }
        setUrls((previous) => {
          const next = new Map(previous);
          for (const { id, url } of results) if (url) next.set(id, url);
          return next;
        });
        setTried((previous) => new Set([...previous, ...results.map(({ id }) => id)]));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [api, key]);

  // As URLs só são liberadas ao sair da tela: o editor continua usando as antigas.
  const latest = useRef(urls);
  useEffect(() => {
    latest.current = urls;
  }, [urls]);
  useEffect(
    () => () => {
      for (const url of latest.current.values()) URL.revokeObjectURL(url);
    },
    [],
  );

  return { urls, ready: html !== undefined && key === '' };
}
