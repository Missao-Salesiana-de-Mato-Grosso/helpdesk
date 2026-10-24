import { Stack, Text, Title } from '@mantine/core';

/** Página vazia de uma rota cuja tela chega numa tarefa futura do backlog. */
export function PlaceholderPage({ title, task }: { title: string; task: string }) {
  return (
    <Stack gap="xs">
      <Title order={2}>{title}</Title>
      <Text c="dimmed">Em construção ({task}).</Text>
    </Stack>
  );
}
