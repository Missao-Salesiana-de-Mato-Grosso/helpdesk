import { Alert, Button, Center, Group, Paper, Select, Stack, Text, Title } from '@mantine/core';
import { updateMeSchema, type MeResponse, type NamedRef } from '@helpdesk/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useAuth } from 'react-oidc-context';
import { Navigate, useNavigate } from 'react-router';
import { useApi } from '../api/api-context.ts';
import { homePath } from '../layout/navigation.ts';
import { ME_QUERY_KEY, useMe } from './useMe.ts';

const toOptions = (items: NamedRef[] | undefined) =>
  (items ?? []).map((item) => ({ value: item.id, label: item.name }));

/** Tela de 1º acesso (T16): unidade e departamento obrigatórios antes do resto do portal. */
export function OnboardingPage() {
  const auth = useAuth();
  const api = useApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const companies = useQuery({
    queryKey: ['companies'],
    queryFn: () => api<NamedRef[]>('/companies'),
  });
  const departments = useQuery({
    queryKey: ['departments'],
    queryFn: () => api<NamedRef[]>('/departments'),
  });

  const save = useMutation({
    mutationFn: (body: { companyId: string; departmentId: string }) =>
      api<MeResponse>('/me', { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: (updated) => {
      queryClient.setQueryData(ME_QUERY_KEY, updated);
      void navigate(homePath(updated.isAgent), { replace: true });
    },
  });

  if (me && !me.needsOnboarding && !save.isPending) {
    return <Navigate to={homePath(me.isAgent)} replace />;
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    const parsed = updateMeSchema.safeParse({ companyId, departmentId });
    if (parsed.success) save.mutate(parsed.data);
  };

  const loadError = companies.error ?? departments.error;

  return (
    <Center mih="100vh" px="md" py="xl">
      <Paper withBorder shadow="sm" p="xl" w="100%" maw={440}>
        <form onSubmit={onSubmit} noValidate>
          <Stack>
            <div>
              <Title order={1} size="h3">
                Primeiro acesso
              </Title>
              <Text c="dimmed" size="sm" mt={4}>
                {me ? `Olá, ${me.name.split(' ')[0]}! ` : ''}Antes de continuar, informe onde você
                trabalha. Isso direciona seus pedidos para a equipe certa.
              </Text>
            </div>

            {loadError && (
              <Alert color="red" title="Não foi possível carregar as opções">
                {loadError.message}
              </Alert>
            )}

            <Select
              label="Unidade"
              placeholder="Escolha a escola ou obra"
              data={toOptions(companies.data)}
              value={companyId}
              onChange={setCompanyId}
              searchable
              nothingFoundMessage="Nenhuma unidade encontrada"
              disabled={companies.isPending}
              error={submitted && !companyId ? 'Informe a unidade' : undefined}
              required
            />
            <Select
              label="Departamento"
              placeholder="Escolha o setor"
              data={toOptions(departments.data)}
              value={departmentId}
              onChange={setDepartmentId}
              searchable
              nothingFoundMessage="Nenhum departamento encontrado"
              disabled={departments.isPending}
              error={submitted && !departmentId ? 'Informe o departamento' : undefined}
              required
            />

            {save.error && (
              <Alert color="red" title="Não foi possível salvar">
                {save.error.message}
              </Alert>
            )}

            <Group justify="space-between" mt="sm">
              <Button variant="subtle" color="gray" onClick={() => void auth.signoutRedirect()}>
                Sair
              </Button>
              <Button type="submit" loading={save.isPending}>
                Continuar
              </Button>
            </Group>
          </Stack>
        </form>
      </Paper>
    </Center>
  );
}
