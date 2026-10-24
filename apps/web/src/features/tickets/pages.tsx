import { useParams } from 'react-router';
import { PlaceholderPage } from '../../components/PlaceholderPage.tsx';

export function MyTicketsPage() {
  return <PlaceholderPage title="Meus tickets" task="T11" />;
}

export function NewTicketPage() {
  return <PlaceholderPage title="Novo ticket" task="T11" />;
}

export function TicketDetailPage() {
  const { number } = useParams();
  return <PlaceholderPage title={`Ticket #${number ?? ''}`} task="T11/T12" />;
}
