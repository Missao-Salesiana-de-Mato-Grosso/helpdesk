// Spec docs/specs/T36-round-robin.md — ordem do rodízio.
import { nextAutoAssignee } from './auto-assign.js';

const ana = { id: '00000000-0000-4000-8000-000000000003', name: 'Ana' };
const bia = { id: '00000000-0000-4000-8000-000000000001', name: 'Bia' };
const caio = { id: '00000000-0000-4000-8000-000000000002', name: 'Caio' };

describe('nextAutoAssignee (T36)', () => {
  it('CT-02 sem último atribuído, começa pelo primeiro em ordem alfabética', () => {
    expect(nextAutoAssignee([caio, bia, ana], null)).toEqual(ana);
  });

  it('CT-03 segue depois do último e volta ao início depois do fim da lista', () => {
    expect(nextAutoAssignee([caio, ana, bia], bia)).toEqual(caio);
    expect(nextAutoAssignee([caio, ana, bia], caio)).toEqual(ana);
  });

  it('CT-04 último que saiu do grupo: continua de onde ele estaria na ordem', () => {
    expect(nextAutoAssignee([ana, caio], bia)).toEqual(caio);
  });

  it('CT-05 sem elegíveis, ninguém', () => {
    expect(nextAutoAssignee([], ana)).toBeNull();
  });

  it('ignora acentos e caixa na ordem; homônimos se desempatam pelo id', () => {
    const alvaro = { id: 'b', name: 'álvaro' };
    const bruno = { id: 'c', name: 'Bruno' };
    expect(nextAutoAssignee([bruno, alvaro], null)).toEqual(alvaro);
    const ana2 = { id: '00000000-0000-4000-8000-000000000009', name: 'Ana' };
    expect(nextAutoAssignee([ana, ana2], ana)).toEqual(ana2);
  });
});
