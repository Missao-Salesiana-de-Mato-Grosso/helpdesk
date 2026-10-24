import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiProvider } from './api/ApiProvider.tsx';
import { OidcProvider } from './auth/OidcProvider.tsx';
import { AppRoutes } from './routes.tsx';
import { theme } from './theme.ts';

/** Provedores globais. O Router fica no main.tsx (BrowserRouter) e nos testes (MemoryRouter). */
export function App() {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <OidcProvider>
        <QueryClientProvider client={queryClient}>
          <ApiProvider>
            <AppRoutes />
          </ApiProvider>
        </QueryClientProvider>
      </OidcProvider>
    </MantineProvider>
  );
}
