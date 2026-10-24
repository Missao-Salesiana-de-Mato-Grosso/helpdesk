import { Navigate, useParams } from 'react-router';
import { PlaceholderPage } from '../../components/PlaceholderPage.tsx';
import { QUEUE_VIEWS, type QueueSlug } from '../../layout/navigation.ts';

const isQueueSlug = (value: string | undefined): value is QueueSlug =>
  value !== undefined && value in QUEUE_VIEWS;

/** Filas do agente: `/fila/:view` (meus, grupo, sem-atribuicao, todos). */
export function QueuePage() {
  const { view } = useParams();
  if (!isQueueSlug(view)) return <Navigate to="/fila/meus" replace />;
  return <PlaceholderPage title={`Fila — ${QUEUE_VIEWS[view].label}`} task="T12" />;
}
