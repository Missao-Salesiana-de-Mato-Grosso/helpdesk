import { describe, expect, it } from 'vitest';
import { homePath, visibleSections } from './navigation.ts';

const titles = (roles: Parameters<typeof visibleSections>[0]) =>
  visibleSections(roles).map((section) => section.title);

describe('visibleSections', () => {
  it('solicitante vê só os próprios pedidos', () => {
    expect(titles([])).toEqual(['Meus pedidos']);
  });

  it('agente e supervisor veem o atendimento, sem administração', () => {
    expect(titles(['agente'])).toEqual(['Atendimento', 'Meus pedidos']);
    expect(titles(['supervisor'])).toEqual(['Atendimento', 'Meus pedidos']);
  });

  it('admin vê tudo', () => {
    expect(titles(['admin'])).toEqual(['Atendimento', 'Meus pedidos', 'Administração']);
  });
});

describe('homePath', () => {
  it('agente vai para a própria fila; solicitante, para os seus tickets', () => {
    expect(homePath(true)).toBe('/fila/meus');
    expect(homePath(false)).toBe('/tickets');
  });
});
