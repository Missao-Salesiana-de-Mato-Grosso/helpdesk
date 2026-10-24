import { Center, Group, Stack, Text, Title } from '@mantine/core';
import type { ReactNode } from 'react';

/** Tela cheia para estados de autenticação (carregando, erro, sem acesso). */
export function StatusScreen({
  title,
  children,
  actions,
}: {
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <Center mih="70vh" px="md">
      <Stack align="center" gap="sm" maw={480} ta="center" aria-live="polite">
        <Title order={1} size="h2">
          {title}
        </Title>
        {children && <Text component="div">{children}</Text>}
        {actions && <Group mt="md">{actions}</Group>}
      </Stack>
    </Center>
  );
}
