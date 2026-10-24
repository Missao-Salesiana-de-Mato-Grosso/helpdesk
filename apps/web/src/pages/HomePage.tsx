import { useAuth } from 'react-oidc-context';
import { useMe } from '../auth/useMe.ts';

// Página provisória para conferir o login. O shell com Mantine e as filas entram na T07 em diante.
export function HomePage() {
  const auth = useAuth();
  const { data: me } = useMe();
  if (!me) return null;
  return (
    <main>
      <h1>Olá, {me.name}</h1>
      <dl>
        <dt>E-mail</dt>
        <dd>{me.email}</dd>
        <dt>Papéis</dt>
        <dd>{me.roles.length > 0 ? me.roles.join(', ') : 'solicitante'}</dd>
        <dt>Unidade</dt>
        <dd>{me.company?.name ?? '—'}</dd>
        <dt>Departamento</dt>
        <dd>{me.department?.name ?? '—'}</dd>
      </dl>
      <button onClick={() => void auth.signoutRedirect()}>Sair</button>
    </main>
  );
}
