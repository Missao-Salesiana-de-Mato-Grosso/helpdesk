import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { theme } from '../theme.ts';
import { HtmlEditor } from './HtmlEditor.tsx';

describe('HtmlEditor', () => {
  it('renderiza a barra em pt-BR e a área de texto rotulada', async () => {
    render(
      <MantineProvider theme={theme} env="test">
        <HtmlEditor label="Descrição" value="<p>oi</p>" onChange={vi.fn()} error="Erro" />
      </MantineProvider>,
    );
    expect(await screen.findByRole('textbox', { name: /Descrição/ })).toHaveTextContent('oi');
    expect(screen.getByRole('button', { name: 'Negrito' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Inserir link' })).toBeInTheDocument();
    expect(screen.getByText('Erro')).toBeInTheDocument();
  });
});
