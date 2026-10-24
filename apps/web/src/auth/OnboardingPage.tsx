import { Button } from '@mantine/core';
import { useAuth } from 'react-oidc-context';
import { StatusScreen } from '../components/StatusScreen.tsx';

// Placeholder: o formulário de unidade e departamento é a T16.
export function OnboardingPage() {
  const auth = useAuth();
  return (
    <StatusScreen
      title="Primeiro acesso"
      actions={
        <Button variant="default" onClick={() => void auth.signoutRedirect()}>
          Sair
        </Button>
      }
    >
      Antes de continuar, informe sua unidade e seu departamento. (Formulário na T16.)
    </StatusScreen>
  );
}
