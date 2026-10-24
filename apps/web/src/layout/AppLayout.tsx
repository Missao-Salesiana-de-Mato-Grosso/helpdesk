import {
  AppShell,
  Avatar,
  Burger,
  Group,
  Menu,
  NavLink,
  ScrollArea,
  Text,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { APP_NAME } from '@helpdesk/shared';
import { useAuth } from 'react-oidc-context';
import { Link, Outlet, useLocation } from 'react-router';
import { useMe } from '../auth/useMe.ts';
import { visibleSections } from './navigation.ts';

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrador',
  supervisor: 'Supervisor',
  agente: 'Agente',
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (
    (parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')
  ).toUpperCase();
}

/** Shell do portal: cabeçalho com usuário e logout, menu lateral por papel, conteúdo da rota. */
export function AppLayout() {
  const auth = useAuth();
  const { data: me } = useMe();
  const location = useLocation();
  const [opened, { toggle, close }] = useDisclosure();

  if (!me) return null;
  const roleLabel = me.roles.map((role) => ROLE_LABELS[role] ?? role).join(', ') || 'Solicitante';

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 240, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger
              opened={opened}
              onClick={toggle}
              hiddenFrom="sm"
              size="sm"
              aria-label="Abrir menu"
            />
            <Title order={1} size="h4">
              {APP_NAME}
            </Title>
          </Group>
          <Menu position="bottom-end" width={240}>
            <Menu.Target>
              <UnstyledButton aria-label="Menu do usuário">
                <Group gap="xs" wrap="nowrap">
                  <Avatar radius="xl" size="sm" color="blue">
                    {initials(me.name)}
                  </Avatar>
                  <Text size="sm" visibleFrom="sm">
                    {me.name}
                  </Text>
                </Group>
              </UnstyledButton>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>
                <Text size="sm" fw={500} c="bright">
                  {me.name}
                </Text>
                <Text size="xs">{me.email}</Text>
                <Text size="xs">{roleLabel}</Text>
              </Menu.Label>
              <Menu.Divider />
              <Menu.Item onClick={() => void auth.signoutRedirect()}>Sair</Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs" aria-label="Menu principal">
        <ScrollArea>
          {visibleSections(me.roles).map((section) => (
            <nav key={section.title} aria-label={section.title}>
              <Text size="xs" fw={700} c="dimmed" tt="uppercase" px="sm" pt="md" pb={4}>
                {section.title}
              </Text>
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  component={Link}
                  to={item.to}
                  label={item.label}
                  active={location.pathname === item.to}
                  onClick={close}
                />
              ))}
            </nav>
          ))}
        </ScrollArea>
      </AppShell.Navbar>

      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
