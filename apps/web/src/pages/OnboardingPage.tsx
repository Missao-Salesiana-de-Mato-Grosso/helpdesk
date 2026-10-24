import { useAuth } from 'react-oidc-context';

// Placeholder: o formulário de unidade e departamento é a T16.
export function OnboardingPage() {
  const auth = useAuth();
  return (
    <main>
      <h1>Primeiro acesso</h1>
      <p>Antes de continuar, informe sua unidade e seu departamento. (Formulário na T16.)</p>
      <button onClick={() => void auth.signoutRedirect()}>Sair</button>
    </main>
  );
}
