import { Navigate, Outlet, Route, Routes } from 'react-router';
import { AuthCallback } from './auth/AuthCallback.tsx';
import { CALLBACK_PATH } from './auth/oidc-config.ts';
import { OnboardingPage } from './auth/OnboardingPage.tsx';
import { ONBOARDING_PATH, RequireAuth } from './auth/RequireAuth.tsx';
import { RequireRole } from './auth/RequireRole.tsx';
import { useMe } from './auth/useMe.ts';
import { StatusScreen } from './components/StatusScreen.tsx';
import { GroupsPage, UsersPage } from './features/admin/pages.tsx';
import { QueuePage } from './features/queue/QueuePage.tsx';
import { MyTicketsPage } from './features/tickets/MyTicketsPage.tsx';
import { NewTicketPage } from './features/tickets/NewTicketPage.tsx';
import { TicketDetailPage } from './features/tickets/TicketDetailPage.tsx';
import { AppLayout } from './layout/AppLayout.tsx';
import { AGENT_ROLES, homePath } from './layout/navigation.ts';

function HomeRedirect() {
  const { data: me } = useMe();
  return me ? <Navigate to={homePath(me.isAgent)} replace /> : null;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path={CALLBACK_PATH} element={<AuthCallback />} />
      <Route
        element={
          <RequireAuth>
            <Outlet />
          </RequireAuth>
        }
      >
        <Route path={ONBOARDING_PATH} element={<OnboardingPage />} />
        <Route element={<AppLayout />}>
          <Route index element={<HomeRedirect />} />
          <Route path="tickets" element={<MyTicketsPage />} />
          <Route path="tickets/novo" element={<NewTicketPage />} />
          <Route path="tickets/:id" element={<TicketDetailPage />} />
          <Route
            path="fila/:view"
            element={
              <RequireRole roles={AGENT_ROLES}>
                <QueuePage />
              </RequireRole>
            }
          />
          <Route path="fila" element={<Navigate to="/fila/meus" replace />} />
          <Route
            path="admin"
            element={
              <RequireRole roles={['admin']}>
                <Outlet />
              </RequireRole>
            }
          >
            <Route index element={<Navigate to="/admin/usuarios" replace />} />
            <Route path="usuarios" element={<UsersPage />} />
            <Route path="grupos" element={<GroupsPage />} />
          </Route>
          <Route path="*" element={<StatusScreen title="Página não encontrada" />} />
        </Route>
      </Route>
    </Routes>
  );
}
