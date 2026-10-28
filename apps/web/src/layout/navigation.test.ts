import { describe, expect, it } from 'vitest';
import { homePath, visibleSections } from './navigation.ts';

const titles = (roles: Parameters<typeof visibleSections>[0]) =>
  visibleSections(roles).map((section) => section.title);

describe('visibleSections', () => {
  it('solicitante vê só os próprios pedidos', () => {
    expect(titles([])).toEqual(['Meus pedidos']);
  });

  it('agente vê o atendimento, sem administração nem liberação', () => {
    expect(titles(['agente'])).toEqual(['Atendimento', 'Meus pedidos']);
  });

  it('supervisor vê o atendimento e a liberação, sem a administração (T15)', () => {
    expect(titles(['supervisor'])).toEqual(['Atendimento', 'Meus pedidos', 'Liberação']);
  });

  it('admin vê tudo', () => {
    expect(titles(['admin'])).toEqual([
      'Atendimento',
      'Meus pedidos',
      'Administração',
      'Liberação',
    ]);
  });
});

describe('homePath', () => {
  it('agente vai para a própria fila; solicitante, para os seus tickets', () => {
    expect(homePath(true)).toBe('/fila/meus');
    expect(homePath(false)).toBe('/tickets');
  });
});
