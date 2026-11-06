import { Select } from '@mantine/core';
import { fillCannedResponse, type CannedVariables } from '@helpdesk/shared';
import { useState } from 'react';
import { useCannedResponses } from './queries.ts';

/**
 * T26: escolhe uma resposta pronta e entrega o HTML com as variáveis trocadas. O campo volta a
 * ficar vazio depois da escolha, para a mesma resposta poder ser inserida de novo.
 */
export function CannedResponsePicker({
  variables,
  onPick,
  disabled = false,
}: {
  variables: CannedVariables;
  onPick: (html: string) => void;
  disabled?: boolean;
}) {
  const canned = useCannedResponses();
  const items = canned.data ?? [];
  const [search, setSearch] = useState('');

  return (
    <Select
      aria-label="Inserir resposta pronta"
      placeholder={items.length === 0 ? 'Nenhuma resposta pronta' : 'Inserir resposta pronta…'}
      data={items.map((item) => ({ value: item.id, label: item.title }))}
      value={null}
      searchValue={search}
      onSearchChange={setSearch}
      onChange={(id) => {
        const item = items.find((candidate) => candidate.id === id);
        setSearch('');
        if (item) onPick(fillCannedResponse(item.bodyHtml, variables));
      }}
      disabled={disabled || items.length === 0}
      searchable
      nothingFoundMessage="Nenhuma resposta com esse título"
      maw={320}
      size="xs"
    />
  );
}
