import { MantineProvider } from '@mantine/core';
import { act, render, screen, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { theme } from '../theme.ts';
import { HtmlEditor, type HtmlEditorHandle } from './HtmlEditor.tsx';

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

  it('insertHtml (T26) acrescenta o HTML sem apagar o texto e avisa o pai', async () => {
    const onChange = vi.fn();
    const handle = createRef<HtmlEditorHandle>();
    render(
      <MantineProvider theme={theme} env="test">
        <HtmlEditor
          label="Resposta"
          value="<p>Bom dia.</p>"
          onChange={onChange}
          handleRef={handle}
        />
      </MantineProvider>,
    );
    await screen.findByRole('textbox', { name: /Resposta/ });
    await waitFor(() => expect(handle.current).not.toBeNull());
    act(() => handle.current!.insertHtml('<p>Olá, <strong>Maria</strong>!</p>'));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const html = String(onChange.mock.lastCall?.[0]);
    expect(html).toContain('Bom dia.');
    expect(html).toContain('<strong>Maria</strong>');
  });
});
