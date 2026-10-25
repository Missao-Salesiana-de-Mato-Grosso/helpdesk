import { Button, Group, Text } from '@mantine/core';
import type { TicketAttachment } from '@helpdesk/shared';
import { useMutation } from '@tanstack/react-query';
import { useApi } from '../../api/api-context.ts';
import { formatSize } from './attachments.ts';

/**
 * Um link comum não leva o Bearer: o download busca o arquivo pela API (com o token) e salva o
 * blob com o nome original.
 */
function useDownload() {
  const api = useApi();
  return useMutation({
    mutationFn: async (attachment: TicketAttachment) => {
      const blob = await api<Blob>(`/attachments/${attachment.id}`, { responseType: 'blob' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = attachment.filename;
      link.click();
      URL.revokeObjectURL(url);
    },
  });
}

export function AttachmentList({ attachments }: { attachments: TicketAttachment[] }) {
  const download = useDownload();
  if (attachments.length === 0) return null;
  return (
    <div>
      <Group gap="xs" mt="sm" aria-label="Anexos">
        {attachments.map((attachment) => (
          <Button
            key={attachment.id}
            variant="light"
            size="compact-sm"
            onClick={() => download.mutate(attachment)}
            loading={download.isPending && download.variables.id === attachment.id}
          >
            {attachment.filename} ({formatSize(attachment.sizeBytes)})
          </Button>
        ))}
      </Group>
      {download.error && (
        <Text size="sm" c="red" mt={4}>
          Não foi possível baixar o arquivo: {download.error.message}
        </Text>
      )}
    </div>
  );
}
