import { Route, Routes } from 'react-router';
import { AuthCallback } from './auth/AuthCallback.tsx';
import { CALLBACK_PATH } from './auth/oidc-config.ts';
import { ONBOARDING_PATH, RequireAuth } from './auth/RequireAuth.tsx';
import { StatusScreen } from './auth/StatusScreen.tsx';
import { HomePage } from './pages/HomePage.tsx';
import { OnboardingPage } from './pages/OnboardingPage.tsx';

export function App() {
  return (
    <Routes>
      <Route path={CALLBACK_PATH} element={<AuthCallback />} />
      <Route
        path={ONBOARDING_PATH}
        element={
          <RequireAuth>
            <OnboardingPage />
          </RequireAuth>
        }
      />
      <Route
        path="/"
        element={
          <RequireAuth>
            <HomePage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<StatusScreen title="Página não encontrada" />} />
    </Routes>
  );
}
