import type { ReactNode } from 'react';

// Tela simples para estados de autenticação (carregando, erro, sem acesso). Ganha o visual do Mantine na T07.
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
    <main className="status-screen" aria-live="polite">
      <h1>{title}</h1>
      {children}
      {actions && <div className="status-actions">{actions}</div>}
    </main>
  );
}
