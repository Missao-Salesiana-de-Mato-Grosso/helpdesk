import { ActionIcon, Alert, Button, FileButton, Group, Stack, Text } from '@mantine/core';
import { ATTACHMENT_ACCEPT, ATTACHMENT_MAX_FILES } from '@helpdesk/shared';
import { useState } from 'react';
import { addFiles, formatSize } from './attachments.ts';

export interface AttachmentPickerProps {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
}

/** Escolha de anexos (T13) com a lista dos escolhidos e remoção. */
export function AttachmentPicker({ files, onChange, disabled = false }: AttachmentPickerProps) {
  const [errors, setErrors] = useState<string[]>([]);

  const pick = (picked: File[]) => {
    const result = addFiles(files, picked);
    setErrors(result.errors);
    onChange(result.files);
  };

  return (
    <Stack gap="xs">
      {files.length > 0 && (
        <Stack gap={4} aria-label="Arquivos anexados">
          {files.map((file, index) => (
            <Group key={`${file.name}-${index}`} gap="xs" wrap="nowrap">
              <Text size="sm" truncate>
                {file.name}
              </Text>
              <Text size="xs" c="dimmed">
                {formatSize(file.size)}
              </Text>
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                aria-label={`Remover ${file.name}`}
                onClick={() => onChange(files.filter((_, i) => i !== index))}
                disabled={disabled}
              >
                ×
              </ActionIcon>
            </Group>
          ))}
        </Stack>
      )}
      {errors.length > 0 && (
        <Alert
          color="red"
          p="xs"
          withCloseButton
          closeButtonLabel="Fechar"
          onClose={() => setErrors([])}
        >
          {errors.map((error) => (
            <Text key={error} size="sm">
              {error}
            </Text>
          ))}
        </Alert>
      )}
      <Group>
        <FileButton onChange={pick} accept={ATTACHMENT_ACCEPT} multiple disabled={disabled}>
          {(props) => (
            <Button
              {...props}
              variant="default"
              size="xs"
              disabled={disabled || files.length >= ATTACHMENT_MAX_FILES}
            >
              Anexar arquivos
            </Button>
          )}
        </FileButton>
        <Text size="xs" c="dimmed">
          Até {ATTACHMENT_MAX_FILES} arquivos de 20 MB (imagens, PDF, Office, texto, ZIP, e-mail).
        </Text>
      </Group>
    </Stack>
  );
}
