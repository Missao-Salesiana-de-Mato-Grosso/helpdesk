import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import './index.css';
import { ApiProvider } from './api/ApiProvider.tsx';
import { App } from './App.tsx';
import { OidcProvider } from './auth/OidcProvider.tsx';

const queryClient = new QueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <OidcProvider>
        <QueryClientProvider client={queryClient}>
          <ApiProvider>
            <App />
          </ApiProvider>
        </QueryClientProvider>
      </OidcProvider>
    </BrowserRouter>
  </StrictMode>,
);
